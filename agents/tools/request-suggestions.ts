import { tool } from "@openai/agents";
import { Output, streamText } from "ai";
import { z } from "zod";
import { getLanguageModel } from "@/agents/providers";
import { getDocumentById, saveSuggestions } from "@/lib/db/queries";
import type { Suggestion } from "@/lib/db/schema";
import { generateUUID } from "@/lib/utils";
import type { AgentRuntimeContext } from "@/agents/types/context";

export function createRequestSuggestionsAgentTool(
  context: AgentRuntimeContext
) {
  return tool({
    name: "requestSuggestions",
    description:
      "Generate writing suggestions for an existing document artifact when the user explicitly asks for improvements.",
    parameters: z.object({
      documentId: z
        .string()
        .describe("The ID of an existing document artifact"),
    }),
    async execute({ documentId }) {
      const document = await getDocumentById({ id: documentId });

      if (!document || !document.content) {
        return { error: "Document not found" };
      }

      if (document.userId !== context.session.user?.id) {
        return { error: "Forbidden" };
      }

      const suggestions: Omit<
        Suggestion,
        "userId" | "createdAt" | "documentCreatedAt"
      >[] = [];

      const { partialOutputStream } = streamText({
        model: getLanguageModel(context.selectedModel),
        system:
          "You are a writing assistant. Given a piece of writing, offer up to 5 suggestions to improve it. Each suggestion must contain full sentences, not just individual words. Describe what changed and why.",
        prompt: document.content,
        output: Output.array({
          element: z.object({
            originalSentence: z.string(),
            suggestedSentence: z.string(),
            description: z.string(),
          }),
        }),
      });

      let processedCount = 0;
      for await (const partialOutput of partialOutputStream) {
        if (!partialOutput) {
          continue;
        }

        for (let i = processedCount; i < partialOutput.length; i++) {
          const element = partialOutput[i];

          if (
            !element?.originalSentence ||
            !element?.suggestedSentence ||
            !element?.description
          ) {
            continue;
          }

          suggestions.push({
            originalText: element.originalSentence,
            suggestedText: element.suggestedSentence,
            description: element.description,
            id: generateUUID(),
            documentId,
            isResolved: false,
          });
          processedCount++;
        }
      }

      if (context.session.user?.id) {
        await saveSuggestions({
          suggestions: suggestions.map((suggestion) => ({
            ...suggestion,
            userId: context.session.user.id,
            createdAt: new Date(),
            documentCreatedAt: document.createdAt,
          })),
        });
      }

      return {
        id: documentId,
        title: document.title,
        kind: document.kind === "image" ? "text" : document.kind,
        message: "Suggestions have been added to the document",
      };
    },
  });
}
