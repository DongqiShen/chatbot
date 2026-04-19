import {
  OpenAIProvider,
  setDefaultModelProvider,
  setTracingDisabled,
} from "@openai/agents";
import { getActiveModels } from "@/agents/config/model-config";

let configuredProviderKey: string | null = null;

export function resolveAgentModelConfig(modelId: string) {
  return getActiveModels().find((model) => model.id === modelId) ?? null;
}

export function resolveOpenAIAgentsModel(modelId: string) {
  if (process.env.OPENAI_MODEL) {
    return process.env.OPENAI_MODEL;
  }

  if (modelId.startsWith("openai/")) {
    return modelId.replace(/^openai\//, "");
  }

  return null;
}

export function configureOpenAIAgentsProvider() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return;
  }

  setTracingDisabled(true);

  const providerCacheKey = JSON.stringify({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL ?? null,
  });

  if (configuredProviderKey === providerCacheKey) {
    return;
  }

  setDefaultModelProvider(
    new OpenAIProvider({
      apiKey,
      ...(process.env.OPENAI_BASE_URL
        ? { baseURL: process.env.OPENAI_BASE_URL }
        : {}),
    })
  );

  configuredProviderKey = providerCacheKey;
}
