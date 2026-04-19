import type { DBMessage } from "@/lib/db/schema";

export const OPENAI_AGENTS_STATE_ATTACHMENT_KIND = "openai-agents-run-state";

type OpenAIAgentsStateAttachment = {
  kind: typeof OPENAI_AGENTS_STATE_ATTACHMENT_KIND;
  state: string;
};

function isOpenAIAgentsStateAttachment(
  value: unknown
): value is OpenAIAgentsStateAttachment {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "state" in value &&
    value.kind === OPENAI_AGENTS_STATE_ATTACHMENT_KIND &&
    typeof value.state === "string"
  );
}

export function createRunStateAttachment(state: string) {
  return {
    kind: OPENAI_AGENTS_STATE_ATTACHMENT_KIND,
    state,
  } satisfies OpenAIAgentsStateAttachment;
}

export function getRunStateAttachment(message: DBMessage) {
  if (!Array.isArray(message.attachments)) {
    return null;
  }

  const attachment = message.attachments.find(isOpenAIAgentsStateAttachment);
  return attachment ?? null;
}

export function findLatestRunStateMessage(messages: DBMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const attachment = getRunStateAttachment(message);

    if (attachment) {
      return {
        message,
        attachment,
      };
    }
  }

  return null;
}
