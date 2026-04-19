import type { StreamedRunResult } from "@openai/agents";
import type { AgentRunResult } from "@/agents/types/result";
import type { ChatMessage } from "@/lib/types";

export function finalizeAgentRun({
  title,
  messages,
  stream,
}: {
  title?: string;
  messages: ChatMessage[];
  stream?: StreamedRunResult<any, any>;
}): AgentRunResult {
  return {
    title,
    messages,
    stream,
  };
}
