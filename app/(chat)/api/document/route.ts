import { z } from "zod";
import { auth } from "@/app/(auth)/auth";
import type { ArtifactKind } from "@/components/chat/artifact";
import {
  deleteDocumentsByIdAfterTimestamp,
  getDocumentsById,
  saveDocument,
  updateDocumentContent,
} from "@/lib/db/queries";
import { ChatbotError } from "@/lib/errors";
import {
  createRequestLogger,
  getDurationMs,
  serializeError,
} from "@/lib/logger";

const documentSchema = z.object({
  content: z.string(),
  title: z.string(),
  kind: z.enum(["text", "code", "image", "sheet"]),
  isManualEdit: z.boolean().optional(),
});

export function GET(request: Request) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "api.document.get",
  });

  return requestLogger.run(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");

      requestLogger.logger.info("Document fetch request received", {
        documentId: id,
      });

      if (!id) {
        requestLogger.logger.warn(
          "Document fetch request rejected because id is missing",
          {
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError(
          "bad_request:api",
          "Parameter id is missing"
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        requestLogger.logger.warn(
          "Document fetch request rejected because user is unauthorized",
          {
            documentId: id,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("unauthorized:document").toResponse();
      }

      const documents = await getDocumentsById({ id });
      const [document] = documents;

      if (!document) {
        requestLogger.logger.warn(
          "Document fetch request returned no document",
          {
            documentId: id,
            userId: session.user.id,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("not_found:document").toResponse();
      }

      if (document.userId !== session.user.id) {
        requestLogger.logger.warn(
          "Document fetch request rejected because user does not own document",
          {
            documentId: id,
            userId: session.user.id,
            ownerUserId: document.userId,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("forbidden:document").toResponse();
      }

      requestLogger.logger.info("Document fetch request completed", {
        documentId: id,
        userId: session.user.id,
        versionCount: documents.length,
        durationMs: getDurationMs(startedAt),
      });
      return Response.json(documents, { status: 200 });
    } catch (error) {
      requestLogger.logger.error("Document fetch request failed", {
        durationMs: getDurationMs(startedAt),
        error: serializeError(error),
      });
      throw error;
    }
  });
}

export function POST(request: Request) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "api.document.post",
  });

  return requestLogger.run(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");

      if (!id) {
        requestLogger.logger.warn(
          "Document save request rejected because id is missing",
          {
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError(
          "bad_request:api",
          "Parameter id is required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        requestLogger.logger.warn(
          "Document save request rejected because user is unauthorized",
          {
            documentId: id,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("not_found:document").toResponse();
      }

      let content: string;
      let title: string;
      let kind: ArtifactKind;
      let isManualEdit: boolean | undefined;

      try {
        const parsed = documentSchema.parse(await request.json());
        content = parsed.content;
        title = parsed.title;
        kind = parsed.kind;
        isManualEdit = parsed.isManualEdit;
      } catch (error) {
        requestLogger.logger.warn(
          "Document save request rejected because body is invalid",
          {
            documentId: id,
            durationMs: getDurationMs(startedAt),
            error: serializeError(error),
          }
        );
        return new ChatbotError(
          "bad_request:api",
          "Invalid request body."
        ).toResponse();
      }

      requestLogger.logger.info("Document save request received", {
        documentId: id,
        userId: session.user.id,
        kind,
        isManualEdit: Boolean(isManualEdit),
        titleLength: title.length,
        contentLength: content.length,
      });

      const documents = await getDocumentsById({ id });

      if (documents.length > 0) {
        const [doc] = documents;

        if (doc.userId !== session.user.id) {
          requestLogger.logger.warn(
            "Document save request rejected because user does not own document",
            {
              documentId: id,
              userId: session.user.id,
              ownerUserId: doc.userId,
              durationMs: getDurationMs(startedAt),
            }
          );
          return new ChatbotError("forbidden:document").toResponse();
        }
      }

      if (isManualEdit && documents.length > 0) {
        const result = await updateDocumentContent({ id, content });
        requestLogger.logger.info("Document content updated manually", {
          documentId: id,
          userId: session.user.id,
          durationMs: getDurationMs(startedAt),
        });
        return Response.json(result, { status: 200 });
      }

      const document = await saveDocument({
        id,
        content,
        title,
        kind,
        userId: session.user.id,
      });

      requestLogger.logger.info("Document saved", {
        documentId: id,
        userId: session.user.id,
        durationMs: getDurationMs(startedAt),
      });
      return Response.json(document, { status: 200 });
    } catch (error) {
      requestLogger.logger.error("Document save request failed", {
        durationMs: getDurationMs(startedAt),
        error: serializeError(error),
      });
      throw error;
    }
  });
}

export function DELETE(request: Request) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "api.document.delete",
  });

  return requestLogger.run(async () => {
    try {
      const { searchParams } = new URL(request.url);
      const id = searchParams.get("id");
      const timestamp = searchParams.get("timestamp");

      if (!id) {
        requestLogger.logger.warn(
          "Document delete request rejected because id is missing",
          {
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError(
          "bad_request:api",
          "Parameter id is required."
        ).toResponse();
      }

      if (!timestamp) {
        requestLogger.logger.warn(
          "Document delete request rejected because timestamp is missing",
          {
            documentId: id,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError(
          "bad_request:api",
          "Parameter timestamp is required."
        ).toResponse();
      }

      const session = await auth();

      if (!session?.user) {
        requestLogger.logger.warn(
          "Document delete request rejected because user is unauthorized",
          {
            documentId: id,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("unauthorized:document").toResponse();
      }

      const documents = await getDocumentsById({ id });
      const [document] = documents;

      if (document.userId !== session.user.id) {
        requestLogger.logger.warn(
          "Document delete request rejected because user does not own document",
          {
            documentId: id,
            userId: session.user.id,
            ownerUserId: document.userId,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError("forbidden:document").toResponse();
      }

      const parsedTimestamp = new Date(timestamp);

      if (Number.isNaN(parsedTimestamp.getTime())) {
        requestLogger.logger.warn(
          "Document delete request rejected because timestamp is invalid",
          {
            documentId: id,
            timestamp,
            durationMs: getDurationMs(startedAt),
          }
        );
        return new ChatbotError(
          "bad_request:api",
          "Invalid timestamp."
        ).toResponse();
      }

      const documentsDeleted = await deleteDocumentsByIdAfterTimestamp({
        id,
        timestamp: parsedTimestamp,
      });

      requestLogger.logger.info("Document delete request completed", {
        documentId: id,
        userId: session.user.id,
        deletedCount: documentsDeleted.length,
        durationMs: getDurationMs(startedAt),
      });
      return Response.json(documentsDeleted, { status: 200 });
    } catch (error) {
      requestLogger.logger.error("Document delete request failed", {
        durationMs: getDurationMs(startedAt),
        error: serializeError(error),
      });
      throw error;
    }
  });
}
