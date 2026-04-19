import { convertToUIMessages } from "@/lib/utils";
import type { DBMessage } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import type {
  ApprovalContinuation,
  ApprovalStatePart,
} from "@/agents/types/approvals";

function isApprovalStatePart(part: Record<string, unknown>) {
  return (
    part.state === "approval-responded" || part.state === "output-denied"
  );
}

function getApprovalStates(messages: ChatMessage[]) {
  return new Map<string, ApprovalStatePart>(
    messages.flatMap((message) =>
      (message.parts ?? [])
        .filter((part) => {
          const candidate = part as Record<string, unknown>;

          if (typeof candidate !== "object" || candidate === null) {
            return false;
          }

          return isApprovalStatePart(candidate);
        })
        .map((part) => {
          const approvalState = part as unknown as ApprovalStatePart;

          return [String(approvalState.toolCallId ?? ""), approvalState] as const;
        })
    )
  );
}

export function mergeApprovalState({
  dbMessages,
  continuationMessages,
}: {
  dbMessages: DBMessage[];
  continuationMessages: ChatMessage[];
}): ApprovalContinuation {
  const dbUiMessages = convertToUIMessages(dbMessages);
  const approvalStates = getApprovalStates(continuationMessages);

  const messages = dbUiMessages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      const toolCallId =
        typeof part === "object" &&
        part !== null &&
        "toolCallId" in part &&
        typeof part.toolCallId !== "undefined"
          ? String(part.toolCallId)
          : null;

      if (toolCallId && approvalStates.has(toolCallId)) {
        return { ...part, ...approvalStates.get(toolCallId) };
      }

      return part;
    }),
  })) as ChatMessage[];

  return {
    messages,
    approvalStates,
  };
}
