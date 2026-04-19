import type { StreamedRunResult } from "@openai/agents";
import type { ChatMessage } from "@/lib/types";

export type AgentRunResult = {
  title?: string;
  messages: ChatMessage[];
  stream?: StreamedRunResult<any, any>;
};
