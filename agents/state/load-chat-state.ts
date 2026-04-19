import type { AgentRuntimeContext } from "@/agents/types/context";
import { buildAgentInput } from "@/agents/runtime/build-input";

export function loadChatState(context: AgentRuntimeContext) {
  return {
    messages: buildAgentInput(context),
  };
}
