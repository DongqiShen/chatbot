import { tool } from "@openai/agents";
import type { UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { documentHandlersByArtifactKind } from "@/lib/artifacts/server";
import { getDocumentById } from "@/lib/db/queries";
import type { ChatMessage } from "@/lib/types";
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

export function createUpdateDocumentAgentTool(context: AgentRuntimeContext) {
  return tool({
    name: "updateDocument",
    description:
      "Full rewrite of an existing artifact. Use for major revisions to an existing document.",
    parameters: z.object({
      id: z.string().describe("The ID of the artifact to rewrite"),
      description: z
        .string()
        .default("Improve the content")
        .describe("The description of changes to make"),
    }),
    async execute({ id, description }) {
      const document = await getDocumentById({ id });

      if (!document) {
        return { error: "Document not found" };
      }

      if (document.userId !== context.session.user?.id) {
        return { error: "Forbidden" };
      }

      const dataStream = getDataStream(context.streamWriter);

      dataStream.write({
        type: "data-clear",
        data: null,
        transient: true,
      });

      const documentHandler = documentHandlersByArtifactKind.find(
        (handler) => handler.kind === document.kind
      );

      if (!documentHandler) {
        return {
          error: `No document handler found for kind: ${document.kind}`,
        };
      }

      await documentHandler.onUpdateDocument({
        document,
        description,
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
        title: document.title,
        kind: document.kind,
        content:
          document.kind === "code"
            ? "The script has been updated successfully."
            : "The document has been updated successfully.",
      };
    },
  });
}
