import type { ChatMessage } from "@/lib/types";

export type ApprovalStatePart = Record<string, unknown> & {
  toolCallId?: string;
  state?: string;
};

export type ApprovalContinuation = {
  messages: ChatMessage[];
  approvalStates: Map<string, ApprovalStatePart>;
};
