import { auth } from "@/app/(auth)/auth";
import { getChatById, getMessagesByChatId } from "@/lib/db/queries";
import {
  createRequestLogger,
  getDurationMs,
  serializeError,
} from "@/lib/logger";
import { convertToUIMessages } from "@/lib/utils";

export function GET(request: Request) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "api.messages.get",
  });

  return requestLogger.run(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const chatId = searchParams.get("chatId");

      if (!chatId) {
        requestLogger.logger.warn(
          "Messages request rejected because chatId is missing",
          {
            durationMs: getDurationMs(startedAt),
          }
        );
        return Response.json({ error: "chatId required" }, { status: 400 });
      }

      requestLogger.logger.info("Messages request received", {
        chatId,
      });

      const [session, chat, messages] = await Promise.all([
        auth(),
        getChatById({ id: chatId }),
        getMessagesByChatId({ id: chatId }),
      ]);

      if (!chat) {
        requestLogger.logger.info(
          "Messages request completed with missing chat",
          {
            chatId,
            durationMs: getDurationMs(startedAt),
          }
        );
        return Response.json({
          messages: [],
          visibility: "private",
          userId: null,
          isReadonly: false,
        });
      }

      if (
        chat.visibility === "private" &&
        (!session?.user || session.user.id !== chat.userId)
      ) {
        requestLogger.logger.warn(
          "Messages request rejected because chat is private",
          {
            chatId,
            userId: session?.user?.id,
            ownerUserId: chat.userId,
            durationMs: getDurationMs(startedAt),
          }
        );
        return Response.json({ error: "forbidden" }, { status: 403 });
      }

      const isReadonly = !session?.user || session.user.id !== chat.userId;

      requestLogger.logger.info("Messages request completed", {
        chatId,
        userId: session?.user?.id,
        messageCount: messages.length,
        isReadonly,
        durationMs: getDurationMs(startedAt),
      });
      return Response.json({
        messages: convertToUIMessages(messages),
        visibility: chat.visibility,
        userId: chat.userId,
        isReadonly,
      });
    } catch (error) {
      requestLogger.logger.error("Messages request failed", {
        durationMs: getDurationMs(startedAt),
        error: serializeError(error),
      });
      throw error;
    }
  });
}
