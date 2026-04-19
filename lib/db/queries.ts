import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/chat/artifact";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import type { ErrorCode } from "../errors";
import { ChatbotError } from "../errors";
import {
  getDurationMs,
  type LogFields,
  logger,
  serializeError,
} from "../logger";
import { generateUUID } from "../utils";
import {
  type Chat,
  chat,
  type DBMessage,
  document,
  message,
  type Suggestion,
  stream,
  suggestion,
  type User,
  user,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";

let dbInstance: ReturnType<typeof drizzle> | null = null;
const dbLogger = logger.child({ component: "database" });

async function withDbOperation<T>(
  {
    operation,
    context,
    errorCode = "bad_request:database",
    errorCause,
    preserveChatbotError = false,
  }: {
    operation: string;
    context?: LogFields;
    errorCode?: ErrorCode;
    errorCause: string;
    preserveChatbotError?: boolean;
  },
  fn: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();

  try {
    const result = await fn();

    dbLogger.debug("Database operation succeeded", {
      operation,
      durationMs: getDurationMs(startedAt),
      ...context,
    });

    return result;
  } catch (error) {
    dbLogger.error("Database operation failed", {
      operation,
      durationMs: getDurationMs(startedAt),
      ...context,
      error: serializeError(error),
    });

    if (preserveChatbotError && error instanceof ChatbotError) {
      throw error;
    }

    throw new ChatbotError(errorCode, errorCause);
  }
}

function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  if (!process.env.POSTGRES_URL) {
    throw new ChatbotError(
      "bad_request:database",
      "POSTGRES_URL is not configured"
    );
  }

  dbLogger.info("Initializing database client");

  const client = postgres(process.env.POSTGRES_URL);
  dbInstance = drizzle(client);

  return dbInstance;
}

export function getUser(email: string): Promise<User[]> {
  return withDbOperation(
    {
      operation: "getUser",
      context: { email },
      errorCause: "Failed to get user by email",
    },
    async () => {
      return await getDb().select().from(user).where(eq(user.email, email));
    }
  );
}

export function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  return withDbOperation(
    {
      operation: "createUser",
      context: { email },
      errorCause: "Failed to create user",
    },
    async () => {
      return await getDb()
        .insert(user)
        .values({ email, password: hashedPassword });
    }
  );
}

export function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  return withDbOperation(
    {
      operation: "createGuestUser",
      context: { email },
      errorCause: "Failed to create guest user",
    },
    async () => {
      return await getDb().insert(user).values({ email, password }).returning({
        id: user.id,
        email: user.email,
      });
    }
  );
}

export function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  return withDbOperation(
    {
      operation: "saveChat",
      context: { chatId: id, userId, visibility },
      errorCause: "Failed to save chat",
    },
    async () => {
      return await getDb().insert(chat).values({
        id,
        createdAt: new Date(),
        userId,
        title,
        visibility,
      });
    }
  );
}

export function deleteChatById({ id }: { id: string }) {
  return withDbOperation(
    {
      operation: "deleteChatById",
      context: { chatId: id },
      errorCause: "Failed to delete chat by id",
    },
    async () => {
      await getDb().delete(vote).where(eq(vote.chatId, id));
      await getDb().delete(message).where(eq(message.chatId, id));
      await getDb().delete(stream).where(eq(stream.chatId, id));

      const [chatsDeleted] = await getDb()
        .delete(chat)
        .where(eq(chat.id, id))
        .returning();
      return chatsDeleted;
    }
  );
}

export function deleteAllChatsByUserId({ userId }: { userId: string }) {
  return withDbOperation(
    {
      operation: "deleteAllChatsByUserId",
      context: { userId },
      errorCause: "Failed to delete all chats by user id",
    },
    async () => {
      const userChats = await getDb()
        .select({ id: chat.id })
        .from(chat)
        .where(eq(chat.userId, userId));

      if (userChats.length === 0) {
        return { deletedCount: 0 };
      }

      const chatIds = userChats.map((c) => c.id);

      await getDb().delete(vote).where(inArray(vote.chatId, chatIds));
      await getDb().delete(message).where(inArray(message.chatId, chatIds));
      await getDb().delete(stream).where(inArray(stream.chatId, chatIds));

      const deletedChats = await getDb()
        .delete(chat)
        .where(eq(chat.userId, userId))
        .returning();

      return { deletedCount: deletedChats.length };
    }
  );
}

export function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  return withDbOperation(
    {
      operation: "getChatsByUserId",
      context: { userId: id, limit, startingAfter, endingBefore },
      errorCause: "Failed to get chats by user id",
      preserveChatbotError: true,
    },
    async () => {
      const extendedLimit = limit + 1;

      const query = (whereCondition?: SQL<unknown>) =>
        getDb()
          .select()
          .from(chat)
          .where(
            whereCondition
              ? and(whereCondition, eq(chat.userId, id))
              : eq(chat.userId, id)
          )
          .orderBy(desc(chat.createdAt))
          .limit(extendedLimit);

      let filteredChats: Chat[] = [];

      if (startingAfter) {
        const [selectedChat] = await getDb()
          .select()
          .from(chat)
          .where(eq(chat.id, startingAfter))
          .limit(1);

        if (!selectedChat) {
          throw new ChatbotError(
            "not_found:database",
            `Chat with id ${startingAfter} not found`
          );
        }

        filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
      } else if (endingBefore) {
        const [selectedChat] = await getDb()
          .select()
          .from(chat)
          .where(eq(chat.id, endingBefore))
          .limit(1);

        if (!selectedChat) {
          throw new ChatbotError(
            "not_found:database",
            `Chat with id ${endingBefore} not found`
          );
        }

        filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
      } else {
        filteredChats = await query();
      }

      const hasMore = filteredChats.length > limit;

      return {
        chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
        hasMore,
      };
    }
  );
}

export function getChatById({ id }: { id: string }) {
  return withDbOperation(
    {
      operation: "getChatById",
      context: { chatId: id },
      errorCause: "Failed to get chat by id",
    },
    async () => {
      const [selectedChat] = await getDb()
        .select()
        .from(chat)
        .where(eq(chat.id, id));
      if (!selectedChat) {
        return null;
      }

      return selectedChat;
    }
  );
}

export function saveMessages({ messages }: { messages: DBMessage[] }) {
  return withDbOperation(
    {
      operation: "saveMessages",
      context: {
        chatId: messages[0]?.chatId,
        messageCount: messages.length,
        messageIds: messages.map((currentMessage) => currentMessage.id),
      },
      errorCause: "Failed to save messages",
    },
    async () => {
      return await getDb().insert(message).values(messages);
    }
  );
}

export function updateMessage({
  id,
  parts,
  attachments,
}: {
  id: string;
  parts: DBMessage["parts"];
  attachments?: DBMessage["attachments"];
}) {
  return withDbOperation(
    {
      operation: "updateMessage",
      context: {
        messageId: id,
        partCount: Array.isArray(parts) ? parts.length : undefined,
        hasAttachments: typeof attachments !== "undefined",
      },
      errorCause: "Failed to update message",
    },
    async () => {
      return await getDb()
        .update(message)
        .set({
          parts,
          ...(typeof attachments !== "undefined" ? { attachments } : {}),
        })
        .where(eq(message.id, id));
    }
  );
}

export function getMessagesByChatId({ id }: { id: string }) {
  return withDbOperation(
    {
      operation: "getMessagesByChatId",
      context: { chatId: id },
      errorCause: "Failed to get messages by chat id",
    },
    async () => {
      return await getDb()
        .select()
        .from(message)
        .where(eq(message.chatId, id))
        .orderBy(asc(message.createdAt));
    }
  );
}

export function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  return withDbOperation(
    {
      operation: "voteMessage",
      context: { chatId, messageId, voteType: type },
      errorCause: "Failed to vote message",
    },
    async () => {
      const [existingVote] = await getDb()
        .select()
        .from(vote)
        .where(and(eq(vote.messageId, messageId)));

      if (existingVote) {
        return await getDb()
          .update(vote)
          .set({ isUpvoted: type === "up" })
          .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
      }
      return await getDb()
        .insert(vote)
        .values({
          chatId,
          messageId,
          isUpvoted: type === "up",
        });
    }
  );
}

export function getVotesByChatId({ id }: { id: string }) {
  return withDbOperation(
    {
      operation: "getVotesByChatId",
      context: { chatId: id },
      errorCause: "Failed to get votes by chat id",
    },
    async () => {
      return await getDb().select().from(vote).where(eq(vote.chatId, id));
    }
  );
}

export function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  return withDbOperation(
    {
      operation: "saveDocument",
      context: { documentId: id, kind, userId, titleLength: title.length },
      errorCause: "Failed to save document",
    },
    async () => {
      return await getDb()
        .insert(document)
        .values({
          id,
          title,
          kind,
          content,
          userId,
          createdAt: new Date(),
        })
        .returning();
    }
  );
}

export function updateDocumentContent({
  id,
  content,
}: {
  id: string;
  content: string;
}) {
  return withDbOperation(
    {
      operation: "updateDocumentContent",
      context: { documentId: id, contentLength: content.length },
      errorCause: "Failed to update document content",
      preserveChatbotError: true,
    },
    async () => {
      const docs = await getDb()
        .select()
        .from(document)
        .where(eq(document.id, id))
        .orderBy(desc(document.createdAt))
        .limit(1);

      const latest = docs[0];
      if (!latest) {
        throw new ChatbotError("not_found:database", "Document not found");
      }

      return await getDb()
        .update(document)
        .set({ content })
        .where(
          and(eq(document.id, id), eq(document.createdAt, latest.createdAt))
        )
        .returning();
    }
  );
}

export function getDocumentsById({ id }: { id: string }) {
  return withDbOperation(
    {
      operation: "getDocumentsById",
      context: { documentId: id },
      errorCause: "Failed to get documents by id",
    },
    async () => {
      const documents = await getDb()
        .select()
        .from(document)
        .where(eq(document.id, id))
        .orderBy(asc(document.createdAt));

      return documents;
    }
  );
}

export function getDocumentById({ id }: { id: string }) {
  return withDbOperation(
    {
      operation: "getDocumentById",
      context: { documentId: id },
      errorCause: "Failed to get document by id",
    },
    async () => {
      const [selectedDocument] = await getDb()
        .select()
        .from(document)
        .where(eq(document.id, id))
        .orderBy(desc(document.createdAt));

      return selectedDocument;
    }
  );
}

export function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  return withDbOperation(
    {
      operation: "deleteDocumentsByIdAfterTimestamp",
      context: { documentId: id, timestamp: timestamp.toISOString() },
      errorCause: "Failed to delete documents by id after timestamp",
    },
    async () => {
      await getDb()
        .delete(suggestion)
        .where(
          and(
            eq(suggestion.documentId, id),
            gt(suggestion.documentCreatedAt, timestamp)
          )
        );

      return await getDb()
        .delete(document)
        .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
        .returning();
    }
  );
}

export function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  return withDbOperation(
    {
      operation: "saveSuggestions",
      context: {
        suggestionCount: suggestions.length,
        documentId: suggestions[0]?.documentId,
      },
      errorCause: "Failed to save suggestions",
    },
    async () => {
      return await getDb().insert(suggestion).values(suggestions);
    }
  );
}

export function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  return withDbOperation(
    {
      operation: "getSuggestionsByDocumentId",
      context: { documentId },
      errorCause: "Failed to get suggestions by document id",
    },
    async () => {
      return await getDb()
        .select()
        .from(suggestion)
        .where(eq(suggestion.documentId, documentId));
    }
  );
}

export function getMessageById({ id }: { id: string }) {
  return withDbOperation(
    {
      operation: "getMessageById",
      context: { messageId: id },
      errorCause: "Failed to get message by id",
    },
    async () => {
      return await getDb().select().from(message).where(eq(message.id, id));
    }
  );
}

export function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  return withDbOperation(
    {
      operation: "deleteMessagesByChatIdAfterTimestamp",
      context: { chatId, timestamp: timestamp.toISOString() },
      errorCause: "Failed to delete messages by chat id after timestamp",
    },
    async () => {
      const messagesToDelete = await getDb()
        .select({ id: message.id })
        .from(message)
        .where(
          and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
        );

      const messageIds = messagesToDelete.map(
        (currentMessage) => currentMessage.id
      );

      if (messageIds.length > 0) {
        await getDb()
          .delete(vote)
          .where(
            and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
          );

        return await getDb()
          .delete(message)
          .where(
            and(eq(message.chatId, chatId), inArray(message.id, messageIds))
          );
      }
    }
  );
}

export function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  return withDbOperation(
    {
      operation: "updateChatVisibilityById",
      context: { chatId, visibility },
      errorCause: "Failed to update chat visibility by id",
    },
    async () => {
      return await getDb()
        .update(chat)
        .set({ visibility })
        .where(eq(chat.id, chatId));
    }
  );
}

export function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  return withDbOperation(
    {
      operation: "updateChatTitleById",
      context: { chatId, titleLength: title.length },
      errorCause: "Failed to update chat title by id",
    },
    async () => {
      return await getDb()
        .update(chat)
        .set({ title })
        .where(eq(chat.id, chatId));
    }
  ).catch(() => undefined);
}

export function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  return withDbOperation(
    {
      operation: "getMessageCountByUserId",
      context: { userId: id, differenceInHours },
      errorCause: "Failed to get message count by user id",
    },
    async () => {
      const cutoffTime = new Date(
        Date.now() - differenceInHours * 60 * 60 * 1000
      );

      const [stats] = await getDb()
        .select({ count: count(message.id) })
        .from(message)
        .innerJoin(chat, eq(message.chatId, chat.id))
        .where(
          and(
            eq(chat.userId, id),
            gte(message.createdAt, cutoffTime),
            eq(message.role, "user")
          )
        )
        .execute();

      return stats?.count ?? 0;
    }
  );
}

export function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  return withDbOperation(
    {
      operation: "createStreamId",
      context: { streamId, chatId },
      errorCause: "Failed to create stream id",
    },
    async () => {
      await getDb()
        .insert(stream)
        .values({ id: streamId, chatId, createdAt: new Date() });
    }
  );
}

export function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  return withDbOperation(
    {
      operation: "getStreamIdsByChatId",
      context: { chatId },
      errorCause: "Failed to get stream ids by chat id",
    },
    async () => {
      const streamIds = await getDb()
        .select({ id: stream.id })
        .from(stream)
        .where(eq(stream.chatId, chatId))
        .orderBy(asc(stream.createdAt))
        .execute();

      return streamIds.map(({ id }) => id);
    }
  );
}
