import type { UIMessageStreamWriter } from "ai";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { ChatMessage } from "@/lib/types";

type ArtifactDeltaKind = Exclude<ArtifactKind, "image">;
type ArtifactDataPartType = "data-codeDelta" | "data-sheetDelta" | "data-textDelta";

const artifactDataPartByKind: Record<ArtifactDeltaKind, ArtifactDataPartType> = {
  code: "data-codeDelta",
  sheet: "data-sheetDelta",
  text: "data-textDelta",
};

export function createArtifactStreamBridge(
  writer: UIMessageStreamWriter<ChatMessage>
) {
  return {
    writeDelta(kind: ArtifactDeltaKind, data: string) {
      writer.write({
        type: artifactDataPartByKind[kind],
        data,
        transient: true,
      });
    },
    writeClear() {
      writer.write({ type: "data-clear", data: null, transient: true });
    },
    writeFinish() {
      writer.write({ type: "data-finish", data: null, transient: true });
    },
    writeMetadata({
      id,
      title,
      kind,
    }: {
      id?: string;
      title?: string;
      kind?: ArtifactKind;
    }) {
      if (id) {
        writer.write({ type: "data-id", data: id, transient: true });
      }

      if (title) {
        writer.write({ type: "data-title", data: title, transient: true });
      }

      if (kind) {
        writer.write({ type: "data-kind", data: kind, transient: true });
      }
    },
  };
}
