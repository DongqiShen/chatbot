import {
  getActiveModels,
  getDefaultChatModelId,
  getModelCapabilitiesMap,
} from "@/config/model-config";

export async function GET() {
  const headers = {
    "Cache-Control": "public, max-age=86400, s-maxage=86400",
  };

  const models = getActiveModels();

  return Response.json(
    {
      capabilities: getModelCapabilitiesMap(models),
      models,
      defaultModelId: getDefaultChatModelId(),
    },
    { headers }
  );
}
