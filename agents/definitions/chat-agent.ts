import { Agent } from "@openai/agents";
import type { AgentRuntimeContext } from "@/agents/types/context";
import { buildAgentSystemPrompt } from "@/agents/runtime/build-system-prompt";
import { createCreateDocumentAgentTool } from "@/agents/tools/create-document";
import { createEditDocumentAgentTool } from "@/agents/tools/edit-document";
import { createGetWeatherAgentTool } from "@/agents/tools/get-weather";
import { createRequestSuggestionsAgentTool } from "@/agents/tools/request-suggestions";
import { createUpdateDocumentAgentTool } from "@/agents/tools/update-document";
import { resolveOpenAIAgentsModel } from "@/agents/shared/model-config";

export function createChatAgentDefinition(context: AgentRuntimeContext) {
  const model = resolveOpenAIAgentsModel(context.selectedModel);

  if (!model) {
    throw new Error(
      `No OpenAI Agents SDK model mapping available for ${context.selectedModel}`
    );
  }

  return new Agent({
    name: "Chat Agent",
    instructions: buildAgentSystemPrompt(context),
    model,
    tools: [
      createGetWeatherAgentTool(context),
      createCreateDocumentAgentTool(context),
      createEditDocumentAgentTool(context),
      createUpdateDocumentAgentTool(context),
      createRequestSuggestionsAgentTool(context),
    ],
  });
}
