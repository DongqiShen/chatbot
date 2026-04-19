import { tool } from "@openai/agents";
import type { UIMessageStreamWriter } from "ai";
import { z } from "zod";
import {
  artifactKinds,
  documentHandlersByArtifactKind,
} from "@/lib/artifacts/server";
import type { ChatMessage } from "@/lib/types";
import { generateUUID } from "@/lib/utils";
import type { AgentRuntimeContext } from "@/agents/types/context";

function getDataStream(
  streamWriter?: UIMessageStreamWriter<ChatMessage>
): UIMessageStreamWriter<ChatMessage> {
  if (streamWriter) {
    return streamWriter;
  }

  return {
    write() {},
    merge() {},
    onError() {},
  } as UIMessageStreamWriter<ChatMessage>;
}

export function createCreateDocumentAgentTool(context: AgentRuntimeContext) {
  return tool({
    name: "createDocument",
    description:
      "Create an artifact. Use kind='code' for programming, kind='text' for prose, and kind='sheet' for spreadsheets.",
    parameters: z.object({
      title: z.string().describe("The title of the artifact"),
      kind: z
        .enum(artifactKinds)
        .describe("Artifact kind: code, text, or sheet"),
    }),
    async execute({ title, kind }) {
      const id = generateUUID();
      const dataStream = getDataStream(context.streamWriter);

      dataStream.write({
        type: "data-kind",
        data: kind,
        transient: true,
      });
      dataStream.write({
        type: "data-id",
        data: id,
        transient: true,
      });
      dataStream.write({
        type: "data-title",
        data: title,
        transient: true,
      });
      dataStream.write({
        type: "data-clear",
        data: null,
        transient: true,
      });

      const documentHandler = documentHandlersByArtifactKind.find(
        (handler) => handler.kind === kind
      );

      if (!documentHandler) {
        return {
          error: `No document handler found for kind: ${kind}`,
        };
      }

      await documentHandler.onCreateDocument({
        id,
        title,
        dataStream,
        session: context.session,
        modelId: context.selectedModel,
      });

      dataStream.write({
        type: "data-finish",
        data: null,
        transient: true,
      });

      return {
        id,
        title,
        kind,
        content:
          kind === "code"
            ? "A script was created and is now visible to the user."
            : "A document was created and is now visible to the user.",
      };
    },
  });
}
