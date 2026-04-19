import {
  getActiveModels,
  getAllGatewayModels,
  getCapabilities,
  getConfiguredChatModel,
  getDefaultChatModelId,
  isDemo,
} from "@/lib/ai/models";

export async function GET() {
  const headers = {
    "Cache-Control": "public, max-age=86400, s-maxage=86400",
  };

  const curatedCapabilities = await getCapabilities();
  const configuredChatModel = getConfiguredChatModel();

  if (isDemo) {
    const models = await getAllGatewayModels();
    const capabilities = Object.fromEntries(
      models.map((m) => [m.id, curatedCapabilities[m.id] ?? m.capabilities])
    );

    return Response.json(
      { capabilities, models, defaultModelId: getDefaultChatModelId() },
      { headers }
    );
  }

  if (configuredChatModel) {
    return Response.json(
      {
        capabilities: {
          [configuredChatModel.id]: {
            tools: true,
            vision: false,
            reasoning: false,
          },
        },
        models: getActiveModels(),
        defaultModelId: configuredChatModel.id,
      },
      { headers }
    );
  }

  return Response.json(
    {
      capabilities: curatedCapabilities,
      defaultModelId: getDefaultChatModelId(),
    },
    { headers }
  );
}
