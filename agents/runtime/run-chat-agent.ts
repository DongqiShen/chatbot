import { run } from "@openai/agents";
import { createChatAgentDefinition } from "@/agents/definitions/chat-agent";
import { buildAgentInput } from "@/agents/runtime/build-input";
import { finalizeAgentRun } from "@/agents/runtime/handle-finish";
import { configureOpenAIAgentsProvider } from "@/agents/shared/model-config";
import type { AgentRuntimeContext } from "@/agents/types/context";
import {
  getDurationMs,
  logger,
  serializeError,
  shouldLogModelIO,
  summarizeText,
} from "@/lib/logger";
import type { ChatMessage } from "@/lib/types";
import { getTextFromMessage } from "@/lib/utils";

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
  const startedAt = Date.now();
  const agentLogger = logger.child({
    component: "agent.runtime",
    chatId: context.chatId,
    userId: context.session.user?.id,
    selectedModel: context.selectedModel,
  });

  try {
    const input = buildAgentInput(context);
    const textOnlyInput = buildTextOnlyInput(input);
    agentLogger.info("Starting chat agent run", {
      inputMessageCount: input.length,
      hasIncomingMessage: Boolean(context.incomingMessage),
      dbMessageCount: context.messagesFromDb.length,
      ...(shouldLogModelIO()
        ? {
            modelInput: summarizeText(textOnlyInput),
          }
        : {}),
    });

    configureOpenAIAgentsProvider();
    const agent = createChatAgentDefinition(context);
    const result = await run(agent, textOnlyInput, {
      stream: true,
      context: {
        chatId: context.chatId,
        userId: context.session.user?.id,
      },
    });

    agentLogger.info("Chat agent stream created", {
      durationMs: getDurationMs(startedAt),
    });

    return finalizeAgentRun({
      messages: input,
      stream: result,
    });
  } catch (error) {
    agentLogger.error("Chat agent run failed", {
      durationMs: getDurationMs(startedAt),
      error: serializeError(error),
    });
    throw error;
  }
}
