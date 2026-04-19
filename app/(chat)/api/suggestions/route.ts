import { auth } from "@/app/(auth)/auth";
import { getSuggestionsByDocumentId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  createRequestLogger,
  getDurationMs,
  serializeError,
} from "@/lib/logger";

export function GET(request: Request) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "api.suggestions.get",
  });

  return requestLogger.run(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const documentId = searchParams.get("documentId");

      requestLogger.logger.info("Suggestions request received", {
        documentId,
      });

      if (!documentId) {
        requestLogger.logger.warn(
          "Suggestions request rejected because documentId is missing",
          {
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError(
          "bad_request:api",
          "Parameter documentId is required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        requestLogger.logger.warn(
          "Suggestions request rejected because user is unauthorized",
          {
            documentId,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("unauthorized:suggestions").toResponse();
      }

      const suggestions = await getSuggestionsByDocumentId({
        documentId,
      });

      const [suggestion] = suggestions;

      if (!suggestion) {
        requestLogger.logger.info(
          "Suggestions request completed with no suggestions",
          {
            documentId,
            userId: session.user.id,
            durationMs: getDurationMs(startedAt),
          }
        );
        return Response.json([], { status: 200 });
      }

      if (suggestion.userId !== session.user.id) {
        requestLogger.logger.warn(
          "Suggestions request rejected because user does not own document",
          {
            documentId,
            userId: session.user.id,
            ownerUserId: suggestion.userId,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("forbidden:api").toResponse();
      }

      requestLogger.logger.info("Suggestions request completed", {
        documentId,
        userId: session.user.id,
        suggestionCount: suggestions.length,
        durationMs: getDurationMs(startedAt),
      });
      return Response.json(suggestions, { status: 200 });
    } catch (error) {
      requestLogger.logger.error("Suggestions request failed", {
        durationMs: getDurationMs(startedAt),
        error: serializeError(error),
      });
      throw error;
    }
  });
}
