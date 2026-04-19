"use server";

import { generateText, type UIMessage } from "ai";
import { cookies } from "next/headers";
import { titlePrompt } from "@/agents/prompts";
import { getTitleModel } from "@/agents/providers";
import { auth } from "@/app/(auth)/auth";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getChatById,
  getMessageById,
  updateChatVisibilityById,
} from "@/lib/db/queries";
import {
  logger,
  serializeError,
  shouldLogModelIO,
  shouldLogUserMessages,
  summarizeText,
} from "@/lib/logger";
import { getTextFromMessage } from "@/lib/utils";

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("chat-model", model);
  logger.info("Updated chat model cookie", {
    component: "chat.actions",
    model,
  });
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  const actionLogger = logger.child({
    component: "chat.actions",
    action: "generateTitleFromUserMessage",
  });

  try {
    const prompt = getTextFromMessage(message);

    const { text } = await generateText({
      model: getTitleModel(),
      system: titlePrompt,
      prompt,
    });

    const title = text
      .replace(/^[#*"\s]+/, "")
      .replace(/["]+$/, "")
      .trim();

    actionLogger.info("Generated chat title", {
      titleLength: title.length,
      messageId: message.id,
      ...(shouldLogUserMessages()
        ? {
            titlePromptInput: summarizeText(prompt),
          }
        : {}),
      ...(shouldLogModelIO()
        ? {
            titleModelOutput: summarizeText(title),
          }
        : {}),
    });
    return title;
  } catch (error) {
    actionLogger.error("Failed to generate chat title", {
      messageId: message.id,
      error: serializeError(error),
    });
    throw error;
  }
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const actionLogger = logger.child({
    component: "chat.actions",
    action: "deleteTrailingMessages",
    messageId: id,
  });
  const session = await auth();
  if (!session?.user?.id) {
    actionLogger.warn(
      "Rejecting deleteTrailingMessages because user is unauthorized"
    );
    throw new Error("Unauthorized");
  }

  const [message] = await getMessageById({ id });
  if (!message) {
    actionLogger.warn(
      "Rejecting deleteTrailingMessages because message was not found",
      {
        userId: session.user.id,
      }
    );
    throw new Error("Message not found");
  }

  const chat = await getChatById({ id: message.chatId });
  if (!chat || chat.userId !== session.user.id) {
    actionLogger.warn(
      "Rejecting deleteTrailingMessages because user does not own chat",
      {
        userId: session.user.id,
        chatId: message.chatId,
      }
    );
    throw new Error("Unauthorized");
  }

  try {
    await deleteMessagesByChatIdAfterTimestamp({
      chatId: message.chatId,
      timestamp: message.createdAt,
    });
    actionLogger.info("Deleted trailing messages", {
      userId: session.user.id,
      chatId: message.chatId,
      timestamp: message.createdAt.toISOString(),
    });
  } catch (error) {
    actionLogger.error("Failed to delete trailing messages", {
      userId: session.user.id,
      chatId: message.chatId,
      error: serializeError(error),
    });
    throw error;
  }
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  const actionLogger = logger.child({
    component: "chat.actions",
    action: "updateChatVisibility",
    chatId,
    visibility,
  });
  const session = await auth();
  if (!session?.user?.id) {
    actionLogger.warn(
      "Rejecting visibility update because user is unauthorized"
    );
    throw new Error("Unauthorized");
  }

  const chat = await getChatById({ id: chatId });
  if (!chat || chat.userId !== session.user.id) {
    actionLogger.warn(
      "Rejecting visibility update because user does not own chat",
      {
        userId: session.user.id,
      }
    );
    throw new Error("Unauthorized");
  }

  try {
    await updateChatVisibilityById({ chatId, visibility });
    actionLogger.info("Updated chat visibility", {
      userId: session.user.id,
    });
  } catch (error) {
    actionLogger.error("Failed to update chat visibility", {
      userId: session.user.id,
      error: serializeError(error),
    });
    throw error;
  }
}
