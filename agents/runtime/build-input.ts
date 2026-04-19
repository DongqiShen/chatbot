import { convertToUIMessages } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";
import type { AgentRuntimeContext } from "@/agents/types/context";
import { mergeApprovalState } from "@/agents/state/merge-approval-state";

export function buildAgentInput(context: AgentRuntimeContext): ChatMessage[] {
  if (context.continuationMessages?.length) {
    return mergeApprovalState({
      dbMessages: context.messagesFromDb,
      continuationMessages: context.continuationMessages,
    }).messages;
  }

  const dbMessages = convertToUIMessages(context.messagesFromDb);

  return context.incomingMessage
    ? [...dbMessages, context.incomingMessage]
    : dbMessages;
}
