import { RunState, type RunToolApprovalItem, run } from "@openai/agents";
import { geolocation, ipAddress } from "@vercel/functions";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { runChatAgent } from "@/agents";
import { createAgentsUiMessageStream } from "@/agents/bridge/ai-sdk-ui";
import {
  getAllowedModelIds,
  getDefaultChatModelId,
} from "@/agents/config/model-config";
import { createChatAgentDefinition } from "@/agents/definitions/chat-agent";
import {
  createRunStateAttachment,
  findLatestRunStateMessage,
} from "@/agents/state/run-state-attachment";
import { serializeAgentRunResultToMessage } from "@/agents/state/serialize-run-result";
import type { RequestHints } from "@/agents/types/request-hints";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/config/entitlements";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  getChatById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { ChatbotError } from "@/lib/errors";
import {
  createRequestLogger,
  getDurationMs,
  logger,
  serializeError,
  shouldLogModelIO,
  shouldLogToolCalls,
  shouldLogUserMessages,
  summarizeMessageParts,
  summarizeText,
} from "@/lib/logger";
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import {
  convertToUIMessages,
  generateUUID,
  getTextFromMessage,
} from "@/lib/utils";
import { generateTitleFromUserMessage } from "../../actions";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;

function getApprovalIdentity(rawItem: Record<string, unknown>) {
  if (typeof rawItem.id === "string") {
    return rawItem.id;
  }

  if (typeof rawItem.callId === "string") {
    return rawItem.callId;
  }

  return null;
}

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (error) {
    logger.warn("Failed to create resumable stream context", {
      component: "chat.route",
      error: serializeError(error),
    });
    return null;
  }
}

export { getStreamContext };

function createResumableResponse(
  routeLogger: ReturnType<typeof createRequestLogger>["logger"],
  chatId: string,
  stream: ReadableStream<any>
) {
  return createUIMessageStreamResponse({
    stream,
    async consumeSseStream({ stream: sseStream }) {
      if (!process.env.REDIS_URL) {
        return;
      }
      try {
        const streamContext = getStreamContext();
        if (streamContext) {
          const streamId = generateId();
          await createStreamId({ streamId, chatId });
          await streamContext.createNewResumableStream(
            streamId,
            () => sseStream
          );
          routeLogger.debug("Created resumable stream", {
            chatId,
            streamId,
          });
        }
      } catch (error) {
        routeLogger.warn("Failed to persist resumable stream metadata", {
          chatId,
          error: serializeError(error),
        });
      }
    },
  });
}

export function POST(request: Request) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "api.chat.post",
  });

  return requestLogger.run(async () => {
    let requestBody: PostRequestBody;

    try {
      const json = await request.json();
      requestBody = postRequestBodySchema.parse(json);
    } catch (error) {
      requestLogger.logger.warn(
        "Chat request rejected because body validation failed",
        {
          durationMs: getDurationMs(startedAt),
          error: serializeError(error),
        }
      );
      return new ChatbotError("bad_request:api").toResponse();
    }

    try {
      const {
        id,
        message,
        messages,
        selectedChatModel,
        selectedVisibilityType,
      } = requestBody;
      const requestIp = ipAddress(request);

      requestLogger.logger.info("Chat request received", {
        chatId: id,
        hasMessage: Boolean(message),
        isToolApprovalFlow: Boolean(messages),
        selectedChatModel,
        selectedVisibilityType,
        requestIp,
        ...(shouldLogUserMessages()
          ? {
              incomingMessage: message
                ? {
                    role: message.role,
                    parts: summarizeMessageParts(message.parts),
                  }
                : undefined,
            }
          : {}),
      });

      const [, session] = await Promise.all([
        checkBotId().catch((error) => {
          requestLogger.logger.warn("Bot detection check failed", {
            error: serializeError(error),
          });
          return null;
        }),
        auth(),
      ]);

      if (!session?.user) {
        requestLogger.logger.warn(
          "Chat request rejected because user is unauthorized",
          {
            chatId: id,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("unauthorized:chat").toResponse();
      }

      const routeLogger = requestLogger.logger.child({
        chatId: id,
        userId: session.user.id,
      });

      const allowedModelIds = getAllowedModelIds();
      const chatModel = allowedModelIds.has(selectedChatModel)
        ? selectedChatModel
        : getDefaultChatModelId();

      routeLogger.info("Resolved chat model", {
        requestedModel: selectedChatModel,
        selectedModel: chatModel,
        modelFallbackApplied: chatModel !== selectedChatModel,
      });

      await checkIpRateLimit(requestIp);

      const userType: UserType = session.user.type;

      if (isProductionEnvironment) {
        const messageCount = await getMessageCountByUserId({
          id: session.user.id,
          differenceInHours: 1,
        });

        routeLogger.info("Loaded hourly message count", {
          messageCount,
          userType,
          hourlyLimit: entitlementsByUserType[userType].maxMessagesPerHour,
        });

        if (
          messageCount > entitlementsByUserType[userType].maxMessagesPerHour
        ) {
          routeLogger.warn(
            "Chat request rejected because user exceeded hourly message limit",
            {
              messageCount,
              userType,
              durationMs: getDurationMs(startedAt),
            }
          );
          return new ChatbotError("rate_limit:chat").toResponse();
        }
      }

      const isToolApprovalFlow = Boolean(messages);

      const chat = await getChatById({ id });
      let messagesFromDb: DBMessage[] = [];
      let titlePromise: Promise<string> | null = null;

      if (chat) {
        if (chat.userId !== session.user.id) {
          routeLogger.warn(
            "Chat request rejected because user does not own chat",
            {
              ownerUserId: chat.userId,
              durationMs: getDurationMs(startedAt),
            }
          );
          return new ChatbotError("forbidden:chat").toResponse();
        }
        messagesFromDb = await getMessagesByChatId({ id });
        routeLogger.info("Loaded existing chat context", {
          existingMessageCount: messagesFromDb.length,
        });
      } else if (message?.role === "user") {
        await saveChat({
          id,
          userId: session.user.id,
          title: "New chat",
          visibility: selectedVisibilityType,
        });
        titlePromise = generateTitleFromUserMessage({ message });
        routeLogger.info("Created new chat shell", {
          visibility: selectedVisibilityType,
        });
      }

      let uiMessages: ChatMessage[];

      if (isToolApprovalFlow && messages) {
        const dbMessages = convertToUIMessages(messagesFromDb);
        const approvalStates = new Map(
          messages.flatMap(
            (m) =>
              m.parts
                ?.filter(
                  (p: Record<string, unknown>) =>
                    p.state === "approval-responded" ||
                    p.state === "output-denied"
                )
                .map((p: Record<string, unknown>) => [
                  String(p.toolCallId ?? ""),
                  p,
                ]) ?? []
          )
        );
        uiMessages = dbMessages.map((msg) => ({
          ...msg,
          parts: msg.parts.map((part) => {
            if (
              "toolCallId" in part &&
              approvalStates.has(String(part.toolCallId))
            ) {
              return {
                ...part,
                ...approvalStates.get(String(part.toolCallId)),
              };
            }
            return part;
          }),
        })) as ChatMessage[];
      } else {
        uiMessages = [
          ...convertToUIMessages(messagesFromDb),
          message as ChatMessage,
        ];
      }

      routeLogger.debug("Prepared UI messages for agent", {
        uiMessageCount: uiMessages.length,
      });

      const { longitude, latitude, city, country } = geolocation(request);

      const requestHints: RequestHints = {
        longitude,
        latitude,
        city,
        country,
      };

      routeLogger.debug("Computed request hints", requestHints);

      if (message?.role === "user") {
        await saveMessages({
          messages: [
            {
              chatId: id,
              id: message.id,
              role: "user",
              parts: message.parts,
              attachments: [],
              createdAt: new Date(),
            },
          ],
        });
        routeLogger.info("Persisted incoming user message", {
          messageId: message.id,
          ...(shouldLogUserMessages()
            ? {
                persistedMessage: {
                  role: message.role,
                  parts: summarizeMessageParts(message.parts),
                },
              }
            : {}),
        });
      }

      const latestRunStateMessage = findLatestRunStateMessage(messagesFromDb);
      if (isToolApprovalFlow) {
        if (!latestRunStateMessage) {
          routeLogger.warn(
            "Tool approval flow rejected because no run state message exists",
            {
              durationMs: getDurationMs(startedAt),
            }
          );
          return new ChatbotError("bad_request:api").toResponse();
        }

        const agent = createChatAgentDefinition({
          chatId: id,
          session,
          selectedModel: chatModel,
          requestHints,
          messagesFromDb,
        });

        const state = await RunState.fromString(
          agent,
          latestRunStateMessage.attachment.state
        );

        const decisions = new Map<
          string,
          { approved: boolean; reason?: string | undefined }
        >();

        for (const currentMessage of messages ?? []) {
          for (const part of currentMessage.parts ?? []) {
            const approval = (
              part as { approval?: { id?: string; approved?: boolean } }
            ).approval;

            if (
              typeof approval?.id === "string" &&
              typeof approval.approved === "boolean"
            ) {
              decisions.set(approval.id, {
                approved: approval.approved,
                reason:
                  typeof (part as { approval?: { reason?: string } }).approval
                    ?.reason === "string"
                    ? (part as { approval?: { reason?: string } }).approval
                        ?.reason
                    : undefined,
              });
            }
          }
        }

        routeLogger.info("Resuming tool approval flow", {
          approvalDecisionCount: decisions.size,
          ...(shouldLogToolCalls()
            ? {
                approvalDecisions: Array.from(decisions.entries()).map(
                  ([approvalId, decision]) => ({
                    approvalId,
                    approved: decision.approved,
                    reason: decision.reason
                      ? summarizeText(decision.reason)
                      : undefined,
                  })
                ),
              }
            : {}),
        });

        for (const interruption of state.getInterruptions()) {
          const approvalId = getApprovalIdentity(
            interruption.rawItem as Record<string, unknown>
          );

          if (!approvalId) {
            continue;
          }

          const decision = decisions.get(approvalId);
          if (!decision) {
            continue;
          }

          if (decision.approved) {
            state.approve(interruption as RunToolApprovalItem);
          } else {
            state.reject(interruption as RunToolApprovalItem, {
              message: decision.reason,
            });
          }
        }

        let resumedStreamPromise: Promise<
          Awaited<ReturnType<typeof run>>
        > | null = null;

        const stream = createUIMessageStream({
          execute: async ({ writer }) => {
            resumedStreamPromise = run(agent, state, {
              stream: true,
            });

            const resumedStream = await resumedStreamPromise;
            writer.merge(
              createAgentsUiMessageStream(resumedStream, {
                logger: routeLogger,
              })
            );
          },
        });

        after(async () => {
          try {
            const resumedStream = await resumedStreamPromise;
            if (!resumedStream) {
              return;
            }

            await resumedStream.completed;

            const serializedMessage = serializeAgentRunResultToMessage(
              resumedStream,
              {
                existingMessage: latestRunStateMessage.message,
              }
            );

            if (!serializedMessage) {
              routeLogger.warn(
                "Skipped persisting resumed agent response because serialization returned null"
              );
              return;
            }

            await updateMessage({
              id: latestRunStateMessage.message.id,
              parts: serializedMessage.parts,
              attachments: [
                createRunStateAttachment(resumedStream.state.toString()),
              ],
            });

            routeLogger.info("Persisted resumed agent response", {
              messageId: latestRunStateMessage.message.id,
              ...(shouldLogModelIO()
                ? {
                    assistantOutput: summarizeText(
                      getTextFromMessage(serializedMessage)
                    ),
                  }
                : {}),
              ...(shouldLogToolCalls()
                ? {
                    responseParts: summarizeMessageParts(
                      serializedMessage.parts
                    ),
                  }
                : {}),
            });
          } catch (error) {
            routeLogger.error("Failed to persist resumed agent response", {
              error: serializeError(error),
            });
          }
        });

        routeLogger.info("Chat request accepted for resumed stream", {
          durationMs: getDurationMs(startedAt),
        });
        return createResumableResponse(routeLogger, id, stream);
      }

      let agentRunPromise: ReturnType<typeof runChatAgent> | null = null;

      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          agentRunPromise = runChatAgent({
            chatId: id,
            session,
            selectedModel: chatModel,
            requestHints,
            messagesFromDb,
            incomingMessage: message,
            streamWriter: writer,
          });

          const agentRun = await agentRunPromise;

          if (!agentRun.stream) {
            throw new Error("OpenAI Agents runtime did not return a stream");
          }

          writer.merge(
            createAgentsUiMessageStream(agentRun.stream, {
              logger: routeLogger,
            })
          );
        },
        generateId: generateUUID,
      });

      after(async () => {
        try {
          const agentRun = await agentRunPromise;
          if (!agentRun?.stream) {
            return;
          }

          await agentRun.stream.completed;
          const serializedMessage = serializeAgentRunResultToMessage(
            agentRun.stream
          );

          if (titlePromise) {
            const title = await titlePromise;
            await updateChatTitleById({ chatId: id, title });
            routeLogger.info("Updated chat title after agent response", {
              titleLength: title.length,
            });
          }

          if (!serializedMessage) {
            routeLogger.warn(
              "Skipped persisting agent response because serialization returned null"
            );
            return;
          }

          await saveMessages({
            messages: [
              {
                id: serializedMessage.id,
                role: serializedMessage.role,
                parts: serializedMessage.parts,
                createdAt: new Date(),
                attachments: [
                  createRunStateAttachment(agentRun.stream.state.toString()),
                ],
                chatId: id,
              },
            ],
          });

          routeLogger.info("Persisted agent response", {
            messageId: serializedMessage.id,
            ...(shouldLogModelIO()
              ? {
                  assistantOutput: summarizeText(
                    getTextFromMessage(serializedMessage)
                  ),
                }
              : {}),
            ...(shouldLogToolCalls()
              ? {
                  responseParts: summarizeMessageParts(serializedMessage.parts),
                }
              : {}),
          });
        } catch (error) {
          routeLogger.error("Failed to persist agent response", {
            error: serializeError(error),
          });
        }
      });

      routeLogger.info("Chat request accepted for new stream", {
        durationMs: getDurationMs(startedAt),
      });
      return createResumableResponse(routeLogger, id, stream);
    } catch (error) {
      const vercelId = request.headers.get("x-vercel-id");

      if (error instanceof ChatbotError) {
        requestLogger.logger.warn(
          "Chat request failed with handled application error",
          {
            durationMs: getDurationMs(startedAt),
            errorCode: `${error.type}:${error.surface}`,
            statusCode: error.statusCode,
            vercelId,
          }
        );
        return error.toResponse();
      }

      if (
        error instanceof Error &&
        error.message?.includes(
          "AI Gateway requires a valid credit card on file to service requests"
        )
      ) {
        requestLogger.logger.warn(
          "Chat request failed because AI Gateway is not activated",
          {
            durationMs: getDurationMs(startedAt),
            vercelId,
          }
        );
        return new ChatbotError("bad_request:activate_gateway").toResponse();
      }

      requestLogger.logger.error("Unhandled error in chat API", {
        durationMs: getDurationMs(startedAt),
        vercelId,
        error: serializeError(error),
      });
      return new ChatbotError("offline:chat").toResponse();
    }
  });
}

export function DELETE(request: Request) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "api.chat.delete",
  });

  return requestLogger.run(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");

      if (!id) {
        requestLogger.logger.warn(
          "Delete chat request rejected because id is missing",
          {
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("bad_request:api").toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        requestLogger.logger.warn(
          "Delete chat request rejected because user is unauthorized",
          {
            chatId: id,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("unauthorized:chat").toResponse();
      }

      const chat = await getChatById({ id });

      if (chat?.userId !== session.user.id) {
        requestLogger.logger.warn(
          "Delete chat request rejected because user does not own chat",
          {
            chatId: id,
            userId: session.user.id,
            ownerUserId: chat?.userId,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("forbidden:chat").toResponse();
      }

      const deletedChat = await deleteChatById({ id });

      requestLogger.logger.info("Delete chat request completed", {
        chatId: id,
        userId: session.user.id,
        deleted: Boolean(deletedChat),
        durationMs: getDurationMs(startedAt),
      });
      return Response.json(deletedChat, { status: 200 });
    } catch (error) {
      requestLogger.logger.error("Delete chat request failed", {
        durationMs: getDurationMs(startedAt),
        error: serializeError(error),
      });
      throw error;
    }
  });
}
