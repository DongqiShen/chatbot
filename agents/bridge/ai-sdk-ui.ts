import type { AiSdkUiMessageStreamSource } from "@openai/agents-extensions/ai-sdk-ui";
import type { UIMessageStreamWriter } from "ai";
import { createArtifactStreamBridge } from "@/agents/bridge/artifact-stream";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { Logger } from "@/lib/logger";
import {
  shouldLogModelIO,
  shouldLogToolCalls,
  summarizeText,
  summarizeUnknown,
} from "@/lib/logger";
import type { ChatMessage } from "@/lib/types";

export function createAiSdkUiBridge(
  writer: UIMessageStreamWriter<ChatMessage>
) {
  const artifacts = createArtifactStreamBridge(writer);

  return {
    artifacts,
    writeChatTitle(title: string) {
      writer.write({ type: "data-chat-title", data: title });
    },
    writeArtifactMetadata(payload: {
      id?: string;
      title?: string;
      kind?: ArtifactKind;
    }) {
      artifacts.writeMetadata(payload);
    },
    writeArtifactDelta(kind: Exclude<ArtifactKind, "image">, data: string) {
      artifacts.writeDelta(kind, data);
    },
    writeArtifactReset() {
      artifacts.writeClear();
    },
    writeArtifactFinish() {
      artifacts.writeFinish();
    },
  };
}

function resolveEventSource(source: AiSdkUiMessageStreamSource) {
  if ("toStream" in source && typeof source.toStream === "function") {
    return source.toStream();
  }

  return source;
}

function parseJsonArgs(raw: unknown) {
  if (typeof raw !== "string") {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createAgentsUiMessageStream(
  source: AiSdkUiMessageStreamSource,
  options?: { logger?: Logger }
) {
  const events = resolveEventSource(source);
  const streamLogger = options?.logger;

  return new ReadableStream({
    async start(controller) {
      let messageId: string | null = null;
      let stepOpen = false;
      let pendingStepClose = false;
      let responseHasText = false;
      let stepHasTextOutput = false;
      let textOpen = false;
      let currentTextId = "";
      let currentResponseText = "";

      const ensureMessageStart = () => {
        if (!messageId) {
          messageId = createId("message");
          controller.enqueue({ type: "start", messageId });
        }
      };

      const ensureStepStart = () => {
        if (!stepOpen) {
          stepOpen = true;
          pendingStepClose = false;
          stepHasTextOutput = false;
          controller.enqueue({ type: "start-step" });
        }
      };

      const finishStep = () => {
        if (stepOpen) {
          stepOpen = false;
          pendingStepClose = false;
          controller.enqueue({ type: "finish-step" });
        }
      };

      for await (const event of events as AsyncIterable<any>) {
        if (event.type === "raw_model_stream_event") {
          const data = event.data;

          if (data.type === "response_started") {
            ensureMessageStart();
            responseHasText = false;
            currentResponseText = "";
            ensureStepStart();
          }

          if (data.type === "output_text_delta") {
            ensureMessageStart();
            ensureStepStart();
            responseHasText = true;
            stepHasTextOutput = true;

            if (!textOpen) {
              currentTextId = createId("text");
              textOpen = true;
              controller.enqueue({ type: "text-start", id: currentTextId });
            }

            controller.enqueue({
              type: "text-delta",
              id: currentTextId,
              delta: data.delta,
            });
            currentResponseText += data.delta;
          }

          if (data.type === "response_done") {
            if (
              streamLogger &&
              shouldLogModelIO() &&
              currentResponseText.trim()
            ) {
              streamLogger.info("Model response chunk completed", {
                assistantOutput: summarizeText(currentResponseText),
              });
            }

            if (textOpen) {
              textOpen = false;
              controller.enqueue({ type: "text-end", id: currentTextId });
            }

            if (stepOpen) {
              if (stepHasTextOutput) {
                finishStep();
              } else {
                pendingStepClose = true;
              }
            }
          }
        }

        if (event.type === "run_item_stream_event") {
          if (event.name === "message_output_created") {
            ensureMessageStart();

            if (!responseHasText) {
              if (!stepOpen) {
                ensureStepStart();
              }

              const content = event.item?.content;
              if (content) {
                currentResponseText = content;
                const textId = createId("text");
                controller.enqueue({ type: "text-start", id: textId });
                controller.enqueue({
                  type: "text-delta",
                  id: textId,
                  delta: content,
                });
                controller.enqueue({ type: "text-end", id: textId });
                stepHasTextOutput = true;
                responseHasText = true;

                if (streamLogger && shouldLogModelIO()) {
                  streamLogger.info("Model response message created", {
                    assistantOutput: summarizeText(content),
                  });
                }
              }
            }

            if (pendingStepClose) {
              finishStep();
            }
          }

          if (event.name === "tool_called") {
            ensureMessageStart();
            ensureStepStart();

            const raw = event.item?.rawItem ?? {};
            const toolName = String(
              raw.name ?? raw.type ?? event.item?.toolName ?? "tool"
            );
            const toolCallId = String(
              raw.callId ?? raw.id ?? `${toolName}-${createId("call")}`
            );
            const input =
              typeof raw.arguments === "string"
                ? parseJsonArgs(raw.arguments)
                : {};

            if (streamLogger && shouldLogToolCalls()) {
              streamLogger.info("Tool call started", {
                toolCallId,
                toolName,
                toolInput: summarizeUnknown(input),
              });
            }

            controller.enqueue({
              type: "tool-input-start",
              toolCallId,
              toolName,
              dynamic: true,
            });
            controller.enqueue({
              type: "tool-input-available",
              toolCallId,
              toolName,
              input,
              dynamic: true,
            });
          }

          if (event.name === "tool_output") {
            ensureMessageStart();
            ensureStepStart();

            const raw = event.item?.rawItem ?? {};
            const toolCallId = String(raw.callId ?? raw.id ?? createId("call"));
            const output =
              typeof event.item?.output !== "undefined"
                ? event.item.output
                : raw.output;

            if (streamLogger && shouldLogToolCalls()) {
              streamLogger.info("Tool output received", {
                toolCallId,
                toolOutput: summarizeUnknown(output),
              });
            }

            controller.enqueue({
              type: "tool-output-available",
              toolCallId,
              output,
              dynamic: true,
            });
          }

          if (event.name === "tool_approval_requested") {
            ensureMessageStart();
            ensureStepStart();

            const raw = event.item?.rawItem ?? {};
            const toolName = String(
              raw.name ?? raw.type ?? event.item?.toolName ?? "tool"
            );
            const toolCallId = String(
              raw.callId ?? raw.id ?? `${toolName}-${createId("call")}`
            );
            const approvalId = String(raw.id ?? toolCallId);

            if (streamLogger && shouldLogToolCalls()) {
              streamLogger.info("Tool approval requested", {
                toolCallId,
                approvalId,
                toolName,
              });
            }

            controller.enqueue({
              type: "tool-approval-request",
              toolCallId,
              approvalId,
            });
          }
        }
      }

      if (textOpen) {
        controller.enqueue({ type: "text-end", id: currentTextId });
      }
      if (stepOpen) {
        controller.enqueue({ type: "finish-step" });
      }
      controller.enqueue({ type: "finish", finishReason: "stop" });
      controller.close();
    },
  });
}
