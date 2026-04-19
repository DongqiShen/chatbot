import { tool } from "@openai/agents";
import type { UIMessageStreamWriter } from "ai";
import { z } from "zod";
import { getDocumentById, saveDocument } from "@/lib/db/queries";
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

export function createEditDocumentAgentTool(context: AgentRuntimeContext) {
  return tool({
    name: "editDocument",
    description:
      "Perform a targeted edit on an existing artifact by replacing an exact string.",
    parameters: z.object({
      id: z.string().describe("The ID of the artifact to edit"),
      old_string: z
        .string()
        .describe("Exact string to find, ideally with surrounding context"),
      new_string: z.string().describe("Replacement string"),
      replace_all: z
        .boolean()
        .optional()
        .describe("Replace all occurrences instead of just the first"),
    }),
    async execute({ id, old_string, new_string, replace_all }) {
      const document = await getDocumentById({ id });

      if (!document) {
        return { error: "Document not found" };
      }

      if (document.userId !== context.session.user?.id) {
        return { error: "Forbidden" };
      }

      if (!document.content) {
        return { error: "Document has no content" };
      }

      if (!document.content.includes(old_string)) {
        return { error: "old_string not found in document" };
      }

      const updated = replace_all
        ? document.content.replaceAll(old_string, new_string)
        : document.content.replace(old_string, new_string);

      await saveDocument({
        id: document.id,
        title: document.title,
        kind: document.kind,
        content: updated,
        userId: document.userId,
      });

      const dataStream = getDataStream(context.streamWriter);

      dataStream.write({
        type: "data-clear",
        data: null,
        transient: true,
      });

      if (document.kind === "code") {
        dataStream.write({
          type: "data-codeDelta",
          data: updated,
          transient: true,
        });
      } else if (document.kind === "sheet") {
        dataStream.write({
          type: "data-sheetDelta",
          data: updated,
          transient: true,
        });
      } else {
        dataStream.write({
          type: "data-textDelta",
          data: updated,
          transient: true,
        });
      }

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
            ? "The script has been edited successfully."
            : "The document has been edited successfully.",
      };
    },
  });
}
