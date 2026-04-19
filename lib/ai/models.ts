export const DEFAULT_CHAT_MODEL = "moonshotai/kimi-k2-0905";

export const titleModel = {
  id: "mistral/mistral-small",
  name: "Mistral Small",
  provider: "mistral",
  description: "Fast model for title generation",
};

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  reasoning: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
};

const defaultCapabilities: ModelCapabilities = {
  tools: true,
  vision: false,
  reasoning: false,
};

export function getConfiguredChatModel(): ChatModel | null {
  const configuredModelId = process.env.OPENAI_MODEL;

  if (!configuredModelId) {
    return null;
  }

  const [provider = "openai-compatible"] = configuredModelId.split("/");

  return {
    id: configuredModelId,
    name: configuredModelId,
    provider,
    description: "Configured via OPENAI_MODEL",
  };
}

export const chatModels: ChatModel[] = [
  {
    id: "deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2",
    provider: "deepseek",
    description: "Fast and capable model with tool use",
  },
  {
    id: "mistral/codestral",
    name: "Codestral",
    provider: "mistral",
    description: "Code-focused model with tool use",
  },
  {
    id: "mistral/mistral-small",
    name: "Mistral Small",
    provider: "mistral",
    description: "Fast vision model with tool use",
  },
  {
    id: "moonshotai/kimi-k2-0905",
    name: "Kimi K2 0905",
    provider: "moonshotai",
    description: "Fast model with tool use",
  },
  {
    id: "moonshotai/kimi-k2.5",
    name: "Kimi K2.5",
    provider: "moonshotai",
    description: "Moonshot AI flagship model",
  },
  {
    id: "openai/gpt-oss-20b",
    name: "GPT OSS 20B",
    provider: "openai",
    description: "Compact reasoning model",
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT OSS 120B",
    provider: "openai",
    description: "Open-source 120B parameter model",
  },
  {
    id: "xai/grok-4.1-fast-non-reasoning",
    name: "Grok 4.1 Fast",
    provider: "xai",
    description: "Fast non-reasoning model with tool use",
  },
];

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

export function getModelCapabilitiesMap(
  models: ChatModel[] = getActiveModels()
): Record<string, ModelCapabilities> {
  return Object.fromEntries(
    models.map((model) => [model.id, defaultCapabilities])
  );
}

export const allowedModelIds = new Set(
  [...chatModels.map((model) => model.id), process.env.OPENAI_MODEL]
    .filter(Boolean)
    .map((model) => model as string)
);
