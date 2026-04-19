import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import { getChatById, getVotesByChatId, voteMessage } from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  createRequestLogger,
  getDurationMs,
  serializeError,
} from "@/lib/logger";

const voteSchema = z.object({
  chatId: z.string(),
  messageId: z.string(),
  type: z.enum(["up", "down"]),
});

export function GET(request: Request) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "api.vote.get",
  });

  return requestLogger.run(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const chatId = searchParams.get("chatId");

      if (!chatId) {
        requestLogger.logger.warn(
          "Vote fetch request rejected because chatId is missing",
          {
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError(
          "bad_request:api",
          "Parameter chatId is required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        requestLogger.logger.warn(
          "Vote fetch request rejected because user is unauthorized",
          {
            chatId,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("unauthorized:vote").toResponse();
      }

      const chat = await getChatById({ id: chatId });

      if (!chat) {
        requestLogger.logger.warn(
          "Vote fetch request rejected because chat was not found",
          {
            chatId,
            userId: session.user.id,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("not_found:chat").toResponse();
      }

      if (chat.userId !== session.user.id) {
        requestLogger.logger.warn(
          "Vote fetch request rejected because user does not own chat",
          {
            chatId,
            userId: session.user.id,
            ownerUserId: chat.userId,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("forbidden:vote").toResponse();
      }

      const votes = await getVotesByChatId({ id: chatId });

      requestLogger.logger.info("Vote fetch request completed", {
        chatId,
        userId: session.user.id,
        voteCount: votes.length,
        durationMs: getDurationMs(startedAt),
      });
      return Response.json(votes, { status: 200 });
    } catch (error) {
      requestLogger.logger.error("Vote fetch request failed", {
        durationMs: getDurationMs(startedAt),
        error: serializeError(error),
      });
      throw error;
    }
  });
}

export function PATCH(request: Request) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "api.vote.patch",
  });

  return requestLogger.run(async () => {
    let chatId: string;
    let messageId: string;
    let type: "up" | "down";

    try {
      const parsed = voteSchema.parse(await request.json());
      chatId = parsed.chatId;
      messageId = parsed.messageId;
      type = parsed.type;
    } catch (error) {
      requestLogger.logger.warn(
        "Vote patch request rejected because body is invalid",
        {
          durationMs: getDurationMs(startedAt),
          error: serializeError(error),
        }
      );
      return new ChatbotError(
        "bad_request:api",
        "Parameters chatId, messageId, and type are required."
      ).toResponse();
    }

    try {
      const session = await auth();

      if (!session?.user) {
        requestLogger.logger.warn(
          "Vote patch request rejected because user is unauthorized",
          {
            chatId,
            messageId,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("unauthorized:vote").toResponse();
      }

      const chat = await getChatById({ id: chatId });

      if (!chat) {
        requestLogger.logger.warn(
          "Vote patch request rejected because chat was not found",
          {
            chatId,
            messageId,
            userId: session.user.id,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("not_found:vote").toResponse();
      }

      if (chat.userId !== session.user.id) {
        requestLogger.logger.warn(
          "Vote patch request rejected because user does not own chat",
          {
            chatId,
            messageId,
            userId: session.user.id,
            ownerUserId: chat.userId,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("forbidden:vote").toResponse();
      }

      await voteMessage({
        chatId,
        messageId,
        type,
      });

      requestLogger.logger.info("Vote patch request completed", {
        chatId,
        messageId,
        voteType: type,
        userId: session.user.id,
        durationMs: getDurationMs(startedAt),
      });
      return new Response("Message voted", { status: 200 });
    } catch (error) {
      requestLogger.logger.error("Vote patch request failed", {
        chatId,
        messageId,
        durationMs: getDurationMs(startedAt),
        error: serializeError(error),
      });
      throw error;
    }
  });
}
