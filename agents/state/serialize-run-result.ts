import type { StreamedRunResult } from "@openai/agents";
import { generateUUID } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";
import type { DBMessage } from "@/lib/db/schema";

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

function getMessageText(item: unknown) {
  if (
    typeof item !== "object" ||
    item === null ||
    !("content" in item) ||
    typeof item.content !== "string"
  ) {
    return null;
  }

  return item.content.trim() || null;
}

type SerializedToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};

type WeatherToolInput = {
  latitude?: number;
  longitude?: number;
  city?: string;
};

function getSerializedToolCall(item: unknown): SerializedToolCall | null {
  if (
    typeof item !== "object" ||
    item === null ||
    !("rawItem" in item) ||
    typeof item.rawItem !== "object" ||
    item.rawItem === null
  ) {
    return null;
  }

  const rawItem = item.rawItem as Record<string, unknown>;
  const toolName =
    typeof rawItem.name === "string"
      ? rawItem.name
      : typeof rawItem.type === "string"
        ? rawItem.type
        : null;

  const toolCallId =
    typeof rawItem.callId === "string"
      ? rawItem.callId
      : typeof rawItem.id === "string"
        ? rawItem.id
        : null;

  if (!toolName || !toolCallId) {
    return null;
  }

  return {
    toolCallId,
    toolName,
    input: parseJsonArgs(rawItem.arguments),
  };
}

function getToolOutput(item: unknown) {
  if (
    typeof item !== "object" ||
    item === null ||
    !("rawItem" in item) ||
    typeof item.rawItem !== "object" ||
    item.rawItem === null
  ) {
    return null;
  }

  const rawItem = item.rawItem as Record<string, unknown>;
  const toolCallId =
    typeof rawItem.callId === "string"
      ? rawItem.callId
      : typeof rawItem.id === "string"
        ? rawItem.id
        : null;

  if (!toolCallId || !("output" in item)) {
    return null;
  }

  return {
    toolCallId,
    output: (item as { output: unknown }).output,
  };
}

export function serializeAgentRunResultToMessage(
  result: StreamedRunResult<any, any>,
  options?: {
    existingMessage?: DBMessage;
  }
): ChatMessage | null {
  const parts: ChatMessage["parts"] = Array.isArray(options?.existingMessage?.parts)
    ? ([...(options?.existingMessage?.parts as ChatMessage["parts"])] as ChatMessage["parts"])
    : [];
  const toolCalls = new Map<string, SerializedToolCall>();

  for (const interruption of result.interruptions ?? []) {
    const rawItem =
      typeof interruption === "object" && interruption !== null && "rawItem" in interruption
        ? (interruption.rawItem as Record<string, unknown>)
        : null;

    const toolName =
      typeof interruption.name === "string"
        ? interruption.name
        : typeof rawItem?.name === "string"
          ? rawItem.name
          : null;

    const toolCallId =
      typeof rawItem?.callId === "string"
        ? rawItem.callId
        : typeof rawItem?.id === "string"
          ? rawItem.id
          : null;

    const approvalId = typeof rawItem?.id === "string" ? rawItem.id : toolCallId;

    if (toolName !== "getWeather" || !toolCallId || !approvalId) {
      continue;
    }

    const existingIndex = parts.findIndex(
      (part) =>
        part.type === "tool-getWeather" && part.toolCallId === toolCallId
    );

    const input =
      rawItem && typeof rawItem.arguments === "string"
        ? parseJsonArgs(rawItem.arguments)
        : {};

    const approvalPart: ChatMessage["parts"][number] = {
      type: "tool-getWeather" as const,
      toolCallId,
      state: "approval-requested" as const,
      input: input as WeatherToolInput,
      approval: {
        id: approvalId,
      },
    };

    if (existingIndex >= 0) {
      parts[existingIndex] = approvalPart;
    } else {
      parts.push(approvalPart);
    }
  }

  for (const item of result.newItems) {
    if (item.type === "tool_call_item") {
      const toolCall = getSerializedToolCall(item);

      if (toolCall) {
        toolCalls.set(toolCall.toolCallId, toolCall);
      }

      continue;
    }

    if (item.type === "tool_call_output_item") {
      const toolOutput = getToolOutput(item);

      if (!toolOutput) {
        continue;
      }

      const toolCall = toolCalls.get(toolOutput.toolCallId);

      if (toolCall?.toolName === "getWeather") {
        const existingIndex = parts.findIndex(
          (part) =>
            part.type === "tool-getWeather" &&
            part.toolCallId === toolCall.toolCallId
        );

        const nextPart: ChatMessage["parts"][number] = {
          type: "tool-getWeather" as const,
          toolCallId: toolCall.toolCallId,
          state: "output-available" as const,
          input: toolCall.input as WeatherToolInput,
          output: toolOutput.output,
        };

        if (existingIndex >= 0) {
          parts[existingIndex] = nextPart;
        } else {
          parts.push(nextPart);
        }
      }

      if (toolCall?.toolName === "createDocument") {
        const existingIndex = parts.findIndex(
          (part) =>
            part.type === "tool-createDocument" &&
            part.toolCallId === toolCall.toolCallId
        );
        const input = (toolCall.input as {
          title?: string;
          kind?: "text" | "code" | "sheet";
        }) ?? {
          title: "Untitled document",
          kind: "text",
        };
        const output = (toolOutput.output as {
          id?: string;
          title?: string;
          kind?: "text" | "code" | "sheet";
          content?: string;
          error?: string;
        }) ?? { error: "Document creation failed" };
        const nextPart: ChatMessage["parts"][number] =
          "error" in output
            ? {
                type: "tool-createDocument" as const,
                toolCallId: toolCall.toolCallId,
                state: "output-error" as const,
                input: {
                  title: input.title ?? "Untitled document",
                  kind: input.kind ?? "text",
                },
                errorText: output.error ?? "Document creation failed",
              }
            : {
                type: "tool-createDocument" as const,
                toolCallId: toolCall.toolCallId,
                state: "output-available" as const,
                input: {
                  title: input.title ?? "Untitled document",
                  kind: input.kind ?? "text",
                },
                output: {
                  id: output.id ?? generateUUID(),
                  title: output.title ?? input.title ?? "Untitled document",
                  kind: output.kind ?? input.kind ?? "text",
                  content: output.content ?? "",
                },
              };

        if (existingIndex >= 0) {
          parts[existingIndex] = nextPart;
        } else {
          parts.push(nextPart);
        }
      }

      if (toolCall?.toolName === "updateDocument") {
        const existingIndex = parts.findIndex(
          (part) =>
            part.type === "tool-updateDocument" &&
            part.toolCallId === toolCall.toolCallId
        );
        const input = (toolCall.input as {
          id?: string;
          description?: string;
        }) ?? {
          id: "",
          description: "Improve the content",
        };
        const output = (toolOutput.output as {
          id?: string;
          title?: string;
          kind?: "text" | "code" | "sheet";
          content?: string;
          error?: string;
        }) ?? { error: "Document update failed" };

        const nextPart: ChatMessage["parts"][number] =
          "error" in output
            ? {
                type: "tool-updateDocument" as const,
                toolCallId: toolCall.toolCallId,
                state: "output-error" as const,
                input: {
                  id: input.id ?? "",
                  description: input.description ?? "Improve the content",
                },
                errorText: output.error ?? "Document update failed",
              }
            : {
                type: "tool-updateDocument" as const,
                toolCallId: toolCall.toolCallId,
                state: "output-available" as const,
                input: {
                  id: input.id ?? "",
                  description: input.description ?? "Improve the content",
                },
                output: {
                  id: output.id ?? input.id ?? generateUUID(),
                  title: output.title ?? "Untitled document",
                  kind: output.kind ?? "text",
                  content: output.content ?? "",
                },
              };

        if (existingIndex >= 0) {
          parts[existingIndex] = nextPart;
        } else {
          parts.push(nextPart);
        }
      }

      if (toolCall?.toolName === "editDocument") {
        const existingIndex = parts.findIndex(
          (part) =>
            part.type === "tool-updateDocument" &&
            part.toolCallId === toolCall.toolCallId
        );
        const input = (toolCall.input as {
          id?: string;
          old_string?: string;
          new_string?: string;
          replace_all?: boolean;
        }) ?? {
          id: "",
          old_string: "",
          new_string: "",
        };
        const output = (toolOutput.output as {
          id?: string;
          title?: string;
          kind?: "text" | "code" | "sheet";
          content?: string;
          error?: string;
        }) ?? { error: "Document edit failed" };

        const nextPart: ChatMessage["parts"][number] =
          "error" in output
            ? {
                type: "tool-updateDocument" as const,
                toolCallId: toolCall.toolCallId,
                state: "output-error" as const,
                input: {
                  id: input.id ?? "",
                  description: "Targeted edit applied",
                },
                errorText: output.error ?? "Document edit failed",
              }
            : {
                type: "tool-updateDocument" as const,
                toolCallId: toolCall.toolCallId,
                state: "output-available" as const,
                input: {
                  id: input.id ?? "",
                  description: "Targeted edit applied",
                },
                output: {
                  id: output.id ?? input.id ?? generateUUID(),
                  title: output.title ?? "Untitled document",
                  kind: output.kind ?? "text",
                  content: output.content ?? "",
                },
              };

        if (existingIndex >= 0) {
          parts[existingIndex] = nextPart;
        } else {
          parts.push(nextPart);
        }
      }

      if (toolCall?.toolName === "requestSuggestions") {
        const existingIndex = parts.findIndex(
          (part) =>
            part.type === "tool-requestSuggestions" &&
            part.toolCallId === toolCall.toolCallId
        );
        const input = (toolCall.input as {
          documentId?: string;
        }) ?? {
          documentId: "",
        };
        const output = (toolOutput.output as {
          id?: string;
          title?: string;
          kind?: "text" | "code" | "sheet";
          message?: string;
          error?: string;
        }) ?? { error: "Suggestion generation failed" };

        const nextPart: ChatMessage["parts"][number] =
          "error" in output
            ? {
                type: "tool-requestSuggestions" as const,
                toolCallId: toolCall.toolCallId,
                state: "output-error" as const,
                input: {
                  documentId: input.documentId ?? "",
                },
                errorText: output.error ?? "Suggestion generation failed",
              }
            : {
                type: "tool-requestSuggestions" as const,
                toolCallId: toolCall.toolCallId,
                state: "output-available" as const,
                input: {
                  documentId: input.documentId ?? "",
                },
                output: {
                  id: output.id ?? input.documentId ?? generateUUID(),
                  title: output.title ?? "Untitled document",
                  kind: output.kind ?? "text",
                  message:
                    output.message ?? "Suggestions have been added to the document",
                },
              };

        if (existingIndex >= 0) {
          parts[existingIndex] = nextPart;
        } else {
          parts.push(nextPart);
        }
      }

      continue;
    }

    if (item.type === "message_output_item") {
      const text = getMessageText(item);

      if (text) {
        parts.push({
          type: "text",
          text,
        });
      }
    }
  }

  if (!parts.length) {
    return null;
  }

  return {
    id: options?.existingMessage?.id ?? generateUUID(),
    role: "assistant",
    parts,
    metadata: {
      createdAt: new Date().toISOString(),
    },
  };
}
