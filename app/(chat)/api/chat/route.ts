import { geolocation, ipAddress } from "@vercel/functions";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { checkBotId } from "botid/server";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { RunState, run, type RunToolApprovalItem } from "@openai/agents";
import { runChatAgent } from "@/agents";
import { createAgentsUiMessageStream } from "@/agents/bridge/ai-sdk-ui";
import { createChatAgentDefinition } from "@/agents/definitions/chat-agent";
import {
  createRunStateAttachment,
  findLatestRunStateMessage,
} from "@/agents/state/run-state-attachment";
import { serializeAgentRunResultToMessage } from "@/agents/state/serialize-run-result";
import { auth, type UserType } from "@/app/(auth)/auth";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { allowedModelIds, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import type { RequestHints } from "@/lib/ai/prompts";
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
import { checkIpRateLimit } from "@/lib/ratelimit";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
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
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

function createResumableResponse(
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
          await streamContext.createNewResumableStream(streamId, () => sseStream);
        }
      } catch (_) {
        /* non-critical */
      }
    },
  });
}

export async function POST(request: Request) {
  let requestBody: PostRequestBody;

  try {
    const json = await request.json();
    requestBody = postRequestBodySchema.parse(json);
  } catch (_) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  try {
    const { id, message, messages, selectedChatModel, selectedVisibilityType } =
      requestBody;

    const [, session] = await Promise.all([
      checkBotId().catch(() => null),
      auth(),
    ]);

    if (!session?.user) {
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const chatModel = allowedModelIds.has(selectedChatModel)
      ? selectedChatModel
      : DEFAULT_CHAT_MODEL;

    await checkIpRateLimit(ipAddress(request));

    const userType: UserType = session.user.type;

    if (isProductionEnvironment) {
      const messageCount = await getMessageCountByUserId({
        id: session.user.id,
        differenceInHours: 1,
      });

      if (messageCount > entitlementsByUserType[userType].maxMessagesPerHour) {
        return new ChatbotError("rate_limit:chat").toResponse();
      }
    }

    const isToolApprovalFlow = Boolean(messages);

    const chat = await getChatById({ id });
    let messagesFromDb: DBMessage[] = [];
    let titlePromise: Promise<string> | null = null;

    if (chat) {
      if (chat.userId !== session.user.id) {
        return new ChatbotError("forbidden:chat").toResponse();
      }
      messagesFromDb = await getMessagesByChatId({ id });
    } else if (message?.role === "user") {
      await saveChat({
        id,
        userId: session.user.id,
        title: "New chat",
        visibility: selectedVisibilityType,
      });
      titlePromise = generateTitleFromUserMessage({ message });
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
            return { ...part, ...approvalStates.get(String(part.toolCallId)) };
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

    const { longitude, latitude, city, country } = geolocation(request);

    const requestHints: RequestHints = {
      longitude,
      latitude,
      city,
      country,
    };

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
    }

    const latestRunStateMessage = findLatestRunStateMessage(messagesFromDb);
    if (isToolApprovalFlow) {
      if (!latestRunStateMessage) {
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
          const approval = (part as { approval?: { id?: string; approved?: boolean } })
            .approval;

          if (
            typeof approval?.id === "string" &&
            typeof approval.approved === "boolean"
          ) {
            decisions.set(approval.id, {
              approved: approval.approved,
              reason:
                typeof (part as { approval?: { reason?: string } }).approval?.reason ===
                "string"
                  ? (part as { approval?: { reason?: string } }).approval?.reason
                  : undefined,
            });
          }
        }
      }

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

      let resumedStreamPromise: Promise<Awaited<ReturnType<typeof run>>> | null =
        null;

      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          resumedStreamPromise = run(agent, state, {
            stream: true,
          });

          const resumedStream = await resumedStreamPromise;
          writer.merge(createAgentsUiMessageStream(resumedStream));
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
            return;
          }

          await updateMessage({
            id: latestRunStateMessage.message.id,
            parts: serializedMessage.parts,
            attachments: [
              createRunStateAttachment(resumedStream.state.toString()),
            ],
          });
        } catch (error) {
          console.error("Failed to persist resumed OpenAI Agents response:", error);
        }
      });

      return createResumableResponse(id, stream);
    }

    let agentRunPromise:
      | ReturnType<typeof runChatAgent>
      | null = null;

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

        writer.merge(createAgentsUiMessageStream(agentRun.stream));
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
        const serializedMessage = serializeAgentRunResultToMessage(agentRun.stream);

        if (titlePromise) {
          const title = await titlePromise;
          await updateChatTitleById({ chatId: id, title });
        }

        if (!serializedMessage) {
          return;
        }

        await saveMessages({
          messages: [
            {
              id: serializedMessage.id,
              role: serializedMessage.role,
              parts: serializedMessage.parts,
              createdAt: new Date(),
              attachments: [createRunStateAttachment(agentRun.stream.state.toString())],
              chatId: id,
            },
          ],
        });
      } catch (error) {
        console.error("Failed to persist OpenAI Agents response:", error);
      }
    });

    return createResumableResponse(id, stream);
  } catch (error) {
    const vercelId = request.headers.get("x-vercel-id");

    if (error instanceof ChatbotError) {
      return error.toResponse();
    }

    if (
      error instanceof Error &&
      error.message?.includes(
        "AI Gateway requires a valid credit card on file to service requests"
      )
    ) {
      return new ChatbotError("bad_request:activate_gateway").toResponse();
    }

    console.error("Unhandled error in chat API:", error, { vercelId });
    return new ChatbotError("offline:chat").toResponse();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return new ChatbotError("bad_request:api").toResponse();
  }

  const session = await auth();

  if (!session?.user) {
    return new ChatbotError("unauthorized:chat").toResponse();
  }

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new ChatbotError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
}
