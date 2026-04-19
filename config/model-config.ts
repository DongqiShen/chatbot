import "server-only";

import {
  chatModels,
  DEFAULT_CHAT_MODEL,
  type ChatModel,
  type ModelCapabilities,
  titleModel,
} from "@/lib/ai/models";

const defaultCapabilities: ModelCapabilities = {
  tools: true,
  vision: false,
  reasoning: false,
};

function buildConfiguredChatModel(modelId: string): ChatModel {
  const [provider = "openai-compatible"] = modelId.split("/");

  return {
    id: modelId,
    name: modelId,
    provider,
    description: "Configured via OPENAI_MODEL",
  };
}

export function getConfiguredChatModel(): ChatModel | null {
  const configuredModelId = process.env.OPENAI_MODEL;

  if (!configuredModelId) {
    return null;
  }

  return buildConfiguredChatModel(configuredModelId);
}

export function getActiveModels(): ChatModel[] {
  const configuredChatModel = getConfiguredChatModel();

  if (configuredChatModel) {
    return [configuredChatModel];
  }

  return chatModels;
}

export function getDefaultChatModelId() {
  return getConfiguredChatModel()?.id ?? DEFAULT_CHAT_MODEL;
}

export function getAllowedModelIds() {
  return new Set(
    [...chatModels.map((model) => model.id), process.env.OPENAI_MODEL]
      .filter(Boolean)
      .map((model) => model as string)
  );
}

export function getModelCapabilitiesMap(
  models: ChatModel[] = getActiveModels()
): Record<string, ModelCapabilities> {
  return Object.fromEntries(
    models.map((model) => [model.id, defaultCapabilities])
  );
}

export function resolveConfiguredLanguageModelId(modelId: string) {
  return process.env.OPENAI_MODEL || modelId;
}

export function getConfiguredTitleModelId() {
  return resolveConfiguredLanguageModelId(titleModel.id);
}
