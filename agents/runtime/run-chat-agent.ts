import { run } from "@openai/agents";
import { getTextFromMessage } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";
import { createChatAgentDefinition } from "@/agents/definitions/chat-agent";
import { buildAgentInput } from "@/agents/runtime/build-input";
import { finalizeAgentRun } from "@/agents/runtime/handle-finish";
import {
  configureOpenAIAgentsProvider,
} from "@/agents/shared/model-config";
import type { AgentRuntimeContext } from "@/agents/types/context";

function buildTextOnlyInput(messages: ChatMessage[]) {
  const transcript = messages
    .map((message) => {
      const text = getTextFromMessage(message).trim();

      if (!text) {
        return null;
      }

      const role = message.role === "assistant" ? "Assistant" : "User";
      return `${role}: ${text}`;
    })
    .filter(Boolean)
    .join("\n\n");

  return transcript || "User: Hello";
}

export async function runChatAgent(context: AgentRuntimeContext) {
  const input = buildAgentInput(context);
  configureOpenAIAgentsProvider();
  const agent = createChatAgentDefinition(context);
  const result = await run(agent, buildTextOnlyInput(input), {
    stream: true,
    context: {
      chatId: context.chatId,
      userId: context.session.user?.id,
    },
  });

  return finalizeAgentRun({
    messages: input,
    stream: result,
  });
}
