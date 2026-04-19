import { customProvider } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  getConfiguredTitleModelId,
  resolveConfiguredLanguageModelId,
} from "@/config/model-config";
import { isTestEnvironment } from "../constants";

export const myProvider = isTestEnvironment
  ? (() => {
      const { chatModel, titleModel } = require("./models.mock");
      return customProvider({
        languageModels: {
          "chat-model": chatModel,
          "title-model": titleModel,
        },
      });
    })()
  : null;

let compatibleProvider: ReturnType<typeof createOpenAICompatible> | null = null;
let compatibleProviderKey: string | null = null;

function getConfiguredOpenAICompatibleProvider() {
  if (isTestEnvironment) {
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;

  if (!apiKey || !baseURL) {
    return null;
  }

  const providerKey = JSON.stringify({ apiKey, baseURL });

  if (compatibleProvider && compatibleProviderKey === providerKey) {
    return compatibleProvider;
  }

  compatibleProvider = createOpenAICompatible({
    name: "openai-compatible",
    apiKey,
    baseURL,
  });
  compatibleProviderKey = providerKey;

  return compatibleProvider;
}

export function isUsingConfiguredLanguageModel(modelId: string) {
  return resolveConfiguredLanguageModelId(modelId) !== modelId;
}

function getRequiredCompatibleProvider() {
  const provider = getConfiguredOpenAICompatibleProvider();

  if (!provider) {
    throw new Error(
      "OPENAI_API_KEY and OPENAI_BASE_URL must be configured for model generation."
    );
  }

  return provider;
}

export function getLanguageModel(modelId: string) {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel(modelId);
  }

  const configuredProvider = getRequiredCompatibleProvider();
  const resolvedModelId = resolveConfiguredLanguageModelId(modelId);

  return configuredProvider.chatModel(resolvedModelId);
}

export function getTitleModel() {
  if (isTestEnvironment && myProvider) {
    return myProvider.languageModel("title-model");
  }

  const configuredProvider = getRequiredCompatibleProvider();
  const resolvedModelId = getConfiguredTitleModelId();

  return configuredProvider.chatModel(resolvedModelId);
}
