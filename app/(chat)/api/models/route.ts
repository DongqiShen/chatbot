import {
  getActiveModels,
  getDefaultChatModelId,
  getModelCapabilitiesMap,
} from "@/agents/config/model-config";
import { createLogger } from "@/lib/logger";

export function GET() {
  const modelsLogger = createLogger({
    route: "api.models.get",
  });
  const headers = {
    "Cache-Control": "public, max-age=86400, s-maxage=86400",
  };

  const models = getActiveModels();
  modelsLogger.info("Serving model metadata", {
    modelCount: models.length,
    defaultModelId: getDefaultChatModelId(),
  });

  return Response.json(
    {
      capabilities: getModelCapabilitiesMap(models),
      models,
      defaultModelId: getDefaultChatModelId(),
    },
    { headers }
  );
}
