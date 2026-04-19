"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { useEffect, useState } from "react";
import { MessageContent, MessageResponse } from "../ai-elements/message";
import { Shimmer } from "../ai-elements/shimmer";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "../ai-elements/tool";
import { useDataStream } from "./data-stream-provider";
import { DocumentToolCall, DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { Weather } from "./weather";

type WeatherToolPart = Extract<
  ChatMessage["parts"][number],
  { type: "tool-getWeather" }
> | {
  type: "dynamic-tool";
  toolName: "getWeather";
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-denied"
    | "output-error";
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: {
    id: string;
    approved?: boolean;
    reason?: string;
  };
};

type CreateDocumentToolPart = Extract<
  ChatMessage["parts"][number],
  { type: "tool-createDocument" }
> | {
  type: "dynamic-tool";
  toolName: "createDocument";
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-denied"
    | "output-error";
  input?: {
    title?: string;
    kind?: "text" | "code" | "sheet";
  };
  output?: {
    id?: string;
    title?: string;
    kind?: "text" | "code" | "sheet";
    content?: string;
    error?: string;
  };
  errorText?: string;
};

type UpdateDocumentToolPart = Extract<
  ChatMessage["parts"][number],
  { type: "tool-updateDocument" }
> | {
  type: "dynamic-tool";
  toolName: "updateDocument";
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-denied"
    | "output-error";
  input?: {
    id?: string;
    description?: string;
  };
  output?: {
    id?: string;
    title?: string;
    kind?: "text" | "code" | "sheet";
    content?: string;
    error?: string;
  };
  errorText?: string;
};

type EditDocumentToolPart = {
  type: "dynamic-tool";
  toolName: "editDocument";
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-denied"
    | "output-error";
  input?: {
    id?: string;
    old_string?: string;
    new_string?: string;
    replace_all?: boolean;
  };
  output?: {
    id?: string;
    title?: string;
    kind?: "text" | "code" | "sheet";
    content?: string;
    error?: string;
  };
  errorText?: string;
};

type RequestSuggestionsToolPart = Extract<
  ChatMessage["parts"][number],
  { type: "tool-requestSuggestions" }
> | {
  type: "dynamic-tool";
  toolName: "requestSuggestions";
  toolCallId: string;
  state:
    | "input-streaming"
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-denied"
    | "output-error";
  input?: {
    documentId?: string;
  };
  output?: {
    id?: string;
    title?: string;
    kind?: "text" | "code" | "sheet";
    message?: string;
    error?: string;
  };
  errorText?: string;
};

function WeatherToolCard({
  weatherPart,
  isLoading,
  addToolApprovalResponse,
}: {
  weatherPart: WeatherToolPart;
  isLoading: boolean;
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
}) {
  const { toolCallId, state } = weatherPart;
  const approvalId = weatherPart.approval?.id;
  const isDenied =
    state === "output-denied" ||
    (state === "approval-responded" && weatherPart.approval?.approved === false);
  const widthClass = "w-[min(100%,450px)]";
  const isErrorOutput =
    state === "output-available" &&
    weatherPart.output &&
    typeof weatherPart.output === "object" &&
    "error" in weatherPart.output;

  const shouldOpen =
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-requested" ||
    (state === "approval-responded" && isLoading);

  const [open, setOpen] = useState(shouldOpen);

  useEffect(() => {
    setOpen(shouldOpen);
  }, [shouldOpen, toolCallId]);

  if (state === "output-available" && !isErrorOutput) {
    return (
      <div className={widthClass}>
        <Weather weatherAtLocation={weatherPart.output as any} />
      </div>
    );
  }

  if (state === "output-error") {
    return (
      <div className={widthClass}>
        <Tool className="w-full" onOpenChange={setOpen} open={open}>
          <ToolHeader state="output-error" type="tool-getWeather" />
          <ToolContent>
            <div className="px-4 py-3 text-muted-foreground text-sm">
              {weatherPart.errorText || "Weather lookup failed."}
            </div>
          </ToolContent>
        </Tool>
      </div>
    );
  }

  if (isErrorOutput) {
    return (
      <div className={widthClass}>
        <Tool className="w-full" onOpenChange={setOpen} open={open}>
          <ToolHeader state="output-error" type="tool-getWeather" />
          <ToolContent>
            <div className="px-4 py-3 text-muted-foreground text-sm">
              {String((weatherPart.output as { error: unknown }).error)}
            </div>
          </ToolContent>
        </Tool>
      </div>
    );
  }

  if (isDenied) {
    return (
      <div className={widthClass}>
        <Tool className="w-full" onOpenChange={setOpen} open={open}>
          <ToolHeader state="output-denied" type="tool-getWeather" />
          <ToolContent>
            <div className="px-4 py-3 text-muted-foreground text-sm">
              Weather lookup was denied.
            </div>
          </ToolContent>
        </Tool>
      </div>
    );
  }

  if (state === "approval-responded") {
    return (
      <div className={widthClass}>
        <Tool className="w-full" onOpenChange={setOpen} open={open}>
          <ToolHeader state={state} type="tool-getWeather" />
          <ToolContent>
            <ToolInput input={weatherPart.input} />
          </ToolContent>
        </Tool>
      </div>
    );
  }

  return (
    <div className={widthClass}>
      <Tool className="w-full" onOpenChange={setOpen} open={open}>
        <ToolHeader state={state} type="tool-getWeather" />
        <ToolContent>
          {(state === "input-available" || state === "approval-requested") && (
            <ToolInput input={weatherPart.input} />
          )}
          {state === "approval-requested" && approvalId && (
            <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
              <button
                className="rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => {
                  addToolApprovalResponse({
                    id: approvalId,
                    approved: false,
                    reason: "User denied weather lookup",
                  });
                }}
                type="button"
              >
                Deny
              </button>
              <button
                className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90"
                onClick={() => {
                  addToolApprovalResponse({
                    id: approvalId,
                    approved: true,
                  });
                }}
                type="button"
              >
                Allow
              </button>
            </div>
          )}
        </ToolContent>
      </Tool>
    </div>
  );
}

const PurePreviewMessage = ({
  addToolApprovalResponse,
  chatId,
  message,
  vote,
  isLoading,
  setMessages: _setMessages,
  regenerate: _regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  onEdit,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  onEdit?: (message: ChatMessage) => void;
}) => {
  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === "file"
  );

  useDataStream();

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const hasAnyContent = message.parts?.some(
    (part) =>
      (part.type === "text" && part.text?.trim().length > 0) ||
      (part.type === "reasoning" &&
        "text" in part &&
        part.text?.trim().length > 0) ||
      part.type.startsWith("tool-")
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;

  const attachments = attachmentsFromMessage.length > 0 && (
    <div
      className="flex flex-row justify-end gap-2"
      data-testid={"message-attachments"}
    >
      {attachmentsFromMessage.map((attachment) => (
        <PreviewAttachment
          attachment={{
            name: attachment.filename ?? "file",
            contentType: attachment.mediaType,
            url: attachment.url,
          }}
          key={attachment.url}
        />
      ))}
    </div>
  );

  const mergedReasoning = message.parts?.reduce(
    (acc, part) => {
      if (part.type === "reasoning" && part.text?.trim().length > 0) {
        return {
          text: acc.text ? `${acc.text}\n\n${part.text}` : part.text,
          isStreaming: "state" in part ? part.state === "streaming" : false,
          rendered: false,
        };
      }
      return acc;
    },
    { text: "", isStreaming: false, rendered: false }
  ) ?? { text: "", isStreaming: false, rendered: false };

  const parts = message.parts?.map((part, index) => {
    const { type } = part;
    const key = `message-${message.id}-part-${index}`;

    if (type === "reasoning") {
      if (!mergedReasoning.rendered && mergedReasoning.text) {
        mergedReasoning.rendered = true;
        return (
          <MessageReasoning
            isLoading={isLoading || mergedReasoning.isStreaming}
            key={key}
            reasoning={mergedReasoning.text}
          />
        );
      }
      return null;
    }

    if (type === "text") {
      return (
        <MessageContent
          className={cn("text-[13px] leading-[1.65]", {
            "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]":
              message.role === "user",
          })}
          data-testid="message-content"
          key={key}
        >
          <MessageResponse>{sanitizeText(part.text)}</MessageResponse>
        </MessageContent>
      );
    }

    if (
      type === "tool-getWeather" ||
      (type === "dynamic-tool" && part.toolName === "getWeather")
    ) {
      return (
        <WeatherToolCard
          addToolApprovalResponse={addToolApprovalResponse}
          isLoading={isLoading}
          key={(part as WeatherToolPart).toolCallId}
          weatherPart={part as WeatherToolPart}
        />
      );
    }

    if (type === "tool-createDocument") {
      const { toolCallId } = part;

      if (part.output && "error" in part.output) {
        return (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
            key={toolCallId}
          >
            Error creating document: {String(part.output.error)}
          </div>
        );
      }

      return (
        <DocumentPreview
          isReadonly={isReadonly}
          key={toolCallId}
          result={part.output}
        />
      );
    }

    if (type === "dynamic-tool" && part.toolName === "createDocument") {
      const createDocumentPart = part as CreateDocumentToolPart;

      if (createDocumentPart.state === "output-available") {
        if (createDocumentPart.output && "error" in createDocumentPart.output) {
          return (
            <div
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
              key={createDocumentPart.toolCallId}
            >
              Error creating document: {String(createDocumentPart.output.error)}
            </div>
          );
        }

        return (
          <DocumentPreview
            isReadonly={isReadonly}
            key={createDocumentPart.toolCallId}
            result={createDocumentPart.output}
          />
        );
      }

      if (createDocumentPart.state === "output-error") {
        return (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
            key={createDocumentPart.toolCallId}
          >
            Error creating document:{" "}
            {createDocumentPart.errorText || "Unknown error"}
          </div>
        );
      }

      return (
        <DocumentToolCall
          args={{
            title: createDocumentPart.input?.title ?? "Untitled document",
            kind: createDocumentPart.input?.kind ?? "text",
          }}
          isReadonly={isReadonly}
          key={createDocumentPart.toolCallId}
          type="create"
        />
      );
    }

    if (type === "tool-updateDocument") {
      const { toolCallId } = part;

      if (part.output && "error" in part.output) {
        return (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
            key={toolCallId}
          >
            Error updating document: {String(part.output.error)}
          </div>
        );
      }

      return (
        <div className="relative" key={toolCallId}>
          <DocumentPreview
            args={{ ...part.output, isUpdate: true }}
            isReadonly={isReadonly}
            result={part.output}
          />
        </div>
      );
    }

    if (type === "dynamic-tool" && part.toolName === "updateDocument") {
      const updateDocumentPart = part as UpdateDocumentToolPart;

      if (updateDocumentPart.state === "output-available") {
        if (updateDocumentPart.output && "error" in updateDocumentPart.output) {
          return (
            <div
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
              key={updateDocumentPart.toolCallId}
            >
              Error updating document: {String(updateDocumentPart.output.error)}
            </div>
          );
        }

        return (
          <div className="relative" key={updateDocumentPart.toolCallId}>
            <DocumentPreview
              args={{ ...(updateDocumentPart.output ?? {}), isUpdate: true }}
              isReadonly={isReadonly}
              result={updateDocumentPart.output}
            />
          </div>
        );
      }

      if (updateDocumentPart.state === "output-error") {
        return (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
            key={updateDocumentPart.toolCallId}
          >
            Error updating document:{" "}
            {updateDocumentPart.errorText || "Unknown error"}
          </div>
        );
      }

      return (
        <DocumentToolCall
          args={{
            id: updateDocumentPart.input?.id ?? "",
            description:
              updateDocumentPart.input?.description ?? "Updating document",
          }}
          isReadonly={isReadonly}
          key={updateDocumentPart.toolCallId}
          type="update"
        />
      );
    }

    if (type === "dynamic-tool" && part.toolName === "editDocument") {
      const editDocumentPart = part as EditDocumentToolPart;

      if (editDocumentPart.state === "output-available") {
        if (editDocumentPart.output && "error" in editDocumentPart.output) {
          return (
            <div
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
              key={editDocumentPart.toolCallId}
            >
              Error editing document: {String(editDocumentPart.output.error)}
            </div>
          );
        }

        return (
          <div className="relative" key={editDocumentPart.toolCallId}>
            <DocumentPreview
              args={{ ...(editDocumentPart.output ?? {}), isUpdate: true }}
              isReadonly={isReadonly}
              result={editDocumentPart.output}
            />
          </div>
        );
      }

      if (editDocumentPart.state === "output-error") {
        return (
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
            key={editDocumentPart.toolCallId}
          >
            Error editing document:{" "}
            {editDocumentPart.errorText || "Unknown error"}
          </div>
        );
      }

      return (
        <DocumentToolCall
          args={{
            id: editDocumentPart.input?.id ?? "",
            description: "Applying targeted edit",
          }}
          isReadonly={isReadonly}
          key={editDocumentPart.toolCallId}
          type="update"
        />
      );
    }

    if (type === "tool-requestSuggestions") {
      const { toolCallId, state } = part;

      return (
        <Tool
          className="w-[min(100%,450px)]"
          defaultOpen={true}
          key={toolCallId}
        >
          <ToolHeader state={state} type="tool-requestSuggestions" />
          <ToolContent>
            {state === "input-available" && <ToolInput input={part.input} />}
            {state === "output-available" && (
              <ToolOutput
                errorText={undefined}
                output={
                  "error" in part.output ? (
                    <div className="rounded border p-2 text-red-500">
                      Error: {String(part.output.error)}
                    </div>
                  ) : (
                    <DocumentToolResult
                      isReadonly={isReadonly}
                      result={part.output}
                      type="request-suggestions"
                    />
                  )
                }
              />
            )}
          </ToolContent>
        </Tool>
      );
    }

    if (type === "dynamic-tool" && part.toolName === "requestSuggestions") {
      const requestSuggestionsPart = part as RequestSuggestionsToolPart;

      if (
        requestSuggestionsPart.state === "input-streaming" ||
        requestSuggestionsPart.state === "input-available" ||
        requestSuggestionsPart.state === "approval-requested" ||
        requestSuggestionsPart.state === "approval-responded"
      ) {
        return (
          <DocumentToolCall
            args={{
              documentId: requestSuggestionsPart.input?.documentId ?? "",
            }}
            isReadonly={isReadonly}
            key={requestSuggestionsPart.toolCallId}
            type="request-suggestions"
          />
        );
      }

      return (
        <Tool
          className="w-[min(100%,450px)]"
          defaultOpen={true}
          key={requestSuggestionsPart.toolCallId}
        >
          <ToolHeader
            state={requestSuggestionsPart.state}
            toolName="requestSuggestions"
            type="dynamic-tool"
          />
          <ToolContent>
            {requestSuggestionsPart.input && (
              <ToolInput input={requestSuggestionsPart.input} />
            )}
            {requestSuggestionsPart.state === "output-available" &&
              requestSuggestionsPart.output && (
                <ToolOutput
                  errorText={undefined}
                  output={
                    "error" in requestSuggestionsPart.output ? (
                      <div className="rounded border p-2 text-red-500">
                        Error: {String(requestSuggestionsPart.output.error)}
                      </div>
                    ) : (
                      <DocumentToolResult
                        isReadonly={isReadonly}
                        result={{
                          id: requestSuggestionsPart.output.id ?? "",
                          title: requestSuggestionsPart.output.title ?? "Untitled document",
                          kind: requestSuggestionsPart.output.kind ?? "text",
                        }}
                        type="request-suggestions"
                      />
                    )
                  }
                />
              )}
            {requestSuggestionsPart.state === "output-error" && (
              <ToolOutput
                errorText={
                  requestSuggestionsPart.errorText || "Suggestion generation failed"
                }
                output={undefined}
              />
            )}
          </ToolContent>
        </Tool>
      );
    }

    return null;
  });

  const actions = !isReadonly && (
    <MessageActions
      chatId={chatId}
      isLoading={isLoading}
      key={`action-${message.id}`}
      message={message}
      onEdit={onEdit ? () => onEdit(message) : undefined}
      vote={vote}
    />
  );

  const content = isThinking ? (
    <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
      <Shimmer className="font-medium" duration={1}>
        Thinking...
      </Shimmer>
    </div>
  ) : (
    <>
      {attachments}
      {parts}
      {actions}
    </>
  );

  return (
    <div
      className={cn(
        "group/message w-full",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      )}
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn(
          isUser ? "flex flex-col items-end gap-2" : "flex items-start gap-3"
        )}
      >
        {isAssistant && (
          <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
            <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
              <SparklesIcon size={13} />
            </div>
          </div>
        )}
        {isAssistant ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">{content}</div>
        ) : (
          content
        )}
      </div>
    </div>
  );
};

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = () => {
  return (
    <div
      className="group/message w-full"
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-[calc(13px*1.65)] shrink-0 items-center">
          <div className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50">
            <SparklesIcon size={13} />
          </div>
        </div>

        <div className="flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]">
          <Shimmer className="font-medium" duration={1}>
            Thinking...
          </Shimmer>
        </div>
      </div>
    </div>
  );
};
