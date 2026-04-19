import { streamText } from "ai";
import { codePrompt, updateDocumentPrompt } from "@/agents/prompts";
import { getLanguageModel } from "@/agents/providers";
import { createDocumentHandler } from "@/agents/artifacts/server";

function stripFences(code: string): string {
  return code
    .replace(/^```[\w]*\n?/, "")
    .replace(/\n?```\s*$/, "")
    .trim();
}

export const codeDocumentHandler = createDocumentHandler<"code">({
  kind: "code",
  onCreateDocument: async ({ title, dataStream, modelId }) => {
    let draftContent = "";

    const { fullStream } = streamText({
      model: getLanguageModel(modelId),
      system: `${codePrompt}\n\nOutput ONLY the code. No explanations, no markdown fences, no wrapping.`,
      prompt: title,
    });

    for await (const delta of fullStream) {
      if (delta.type === "text-delta") {
        draftContent += delta.text;
        dataStream.write({
          type: "data-codeDelta",
          data: stripFences(draftContent),
          transient: true,
        });
      }
    }

    return stripFences(draftContent);
  },
  onUpdateDocument: async ({ document, description, dataStream, modelId }) => {
    let draftContent = "";

    const { fullStream } = streamText({
      model: getLanguageModel(modelId),
      system: `${updateDocumentPrompt(document.content, "code")}\n\nOutput ONLY the complete updated code. No explanations, no markdown fences, no wrapping.`,
      prompt: description,
    });

    for await (const delta of fullStream) {
      if (delta.type === "text-delta") {
        draftContent += delta.text;
        dataStream.write({
          type: "data-codeDelta",
          data: stripFences(draftContent),
          transient: true,
        });
      }
    }

    return stripFences(draftContent);
  },
});
