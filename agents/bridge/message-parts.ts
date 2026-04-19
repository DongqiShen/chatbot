import type { ArtifactKind } from "@/components/chat/artifact";

export function createToolCallPart({
  type,
  toolCallId,
  state,
  input,
  output,
  approval,
}: {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  approval?: unknown;
}) {
  return {
    type,
    toolCallId,
    state,
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(approval !== undefined ? { approval } : {}),
  };
}

export function createArtifactMetadataParts({
  id,
  title,
  kind,
}: {
  id?: string;
  title?: string;
  kind?: ArtifactKind;
}) {
  return [
    ...(id ? [{ type: "data-id" as const, data: id }] : []),
    ...(title ? [{ type: "data-title" as const, data: title }] : []),
    ...(kind ? [{ type: "data-kind" as const, data: kind }] : []),
  ];
}
