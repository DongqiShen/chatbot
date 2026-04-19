import {
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { ChatMessage } from "@/lib/types";
import type { AgentRuntimeContext } from "@/agents/types/context";
import type { AgentRunResult } from "@/agents/types/result";

export async function persistAgentRunResult({
  context,
  uiMessagesBeforeRun,
  result,
}: {
  context: AgentRuntimeContext;
  uiMessagesBeforeRun: ChatMessage[];
  result: AgentRunResult;
}) {
  const existingMessageIds = new Set(uiMessagesBeforeRun.map((msg) => msg.id));

  if (result.title) {
    await updateChatTitleById({
      chatId: context.chatId,
      title: result.title,
    });
  }

  for (const message of result.messages) {
    if (existingMessageIds.has(message.id)) {
      await updateMessage({
        id: message.id,
        parts: message.parts,
      });
      continue;
    }

    await saveMessages({
      messages: [
        {
          id: message.id,
          chatId: context.chatId,
          role: message.role,
          parts: message.parts,
          attachments: [],
          createdAt: new Date(),
        },
      ],
    });
  }
}
