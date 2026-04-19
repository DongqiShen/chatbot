import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { deleteAllChatsByUserId, getChatsByUserId } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  createLogger,
  createRequestLogger,
  getDurationMs,
  serializeError,
} from "@/lib/logger";

export function GET(request: NextRequest) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "api.history.get",
  });

  return requestLogger.run(async () => {
    try {
      const { searchParams } = request.nextUrl;

      const limit = Math.min(
        Math.max(Number.parseInt(searchParams.get("limit") || "10", 10), 1),
        50
      );
      const startingAfter = searchParams.get("starting_after");
      const endingBefore = searchParams.get("ending_before");

      requestLogger.logger.info("History request received", {
        limit,
        startingAfter,
        endingBefore,
      });

      if (startingAfter && endingBefore) {
        requestLogger.logger.warn(
          "History request rejected because both cursors were provided",
          {
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError(
          "bad_request:api",
          "Only one of starting_after or ending_before can be provided."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        requestLogger.logger.warn(
          "History request rejected because user is unauthorized",
          {
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("unauthorized:chat").toResponse();
      }

      const chats = await getChatsByUserId({
        id: session.user.id,
        limit,
        startingAfter,
        endingBefore,
      });

      requestLogger.logger.info("History request completed", {
        userId: session.user.id,
        chatCount: chats.chats.length,
        hasMore: chats.hasMore,
        durationMs: getDurationMs(startedAt),
      });

      return Response.json(chats);
    } catch (error) {
      requestLogger.logger.error("History request failed", {
        durationMs: getDurationMs(startedAt),
        error: serializeError(error),
      });
      throw error;
    }
  });
}

export async function DELETE() {
  const historyLogger = createLogger({
    route: "api.history.delete",
  });
  const startedAt = Date.now();

  try {
    const session = await auth();

    if (!session?.user) {
      historyLogger.warn(
        "Delete history request rejected because user is unauthorized",
        {
          durationMs: getDurationMs(startedAt),
        }
      );
      return new ChatbotError("unauthorized:chat").toResponse();
    }

    const result = await deleteAllChatsByUserId({ userId: session.user.id });

    historyLogger.info("Delete history request completed", {
      userId: session.user.id,
      deletedCount: result.deletedCount,
      durationMs: getDurationMs(startedAt),
    });
    return Response.json(result, { status: 200 });
  } catch (error) {
    historyLogger.error("Delete history request failed", {
      durationMs: getDurationMs(startedAt),
      error: serializeError(error),
    });
    throw error;
  }
}
