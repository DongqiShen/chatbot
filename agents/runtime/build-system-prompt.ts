import { systemPrompt } from "@/agents/prompts";
import type { AgentRuntimeContext } from "@/agents/types/context";

export function buildAgentSystemPrompt(
  context: Pick<AgentRuntimeContext, "requestHints">
) {
  return systemPrompt({
    requestHints: context.requestHints,
    supportsTools: true,
  });
}
