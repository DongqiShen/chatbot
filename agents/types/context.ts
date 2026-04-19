import type { Session } from "next-auth";
import type { UIMessageStreamWriter } from "ai";
import type { RequestHints } from "@/lib/ai/prompts";
import type { DBMessage } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";

export type AgentRuntimeContext = {
  chatId: string;
  session: Session;
  selectedModel: string;
  requestHints: RequestHints;
  messagesFromDb: DBMessage[];
  incomingMessage?: ChatMessage;
  continuationMessages?: ChatMessage[];
  streamWriter?: UIMessageStreamWriter<ChatMessage>;
};
