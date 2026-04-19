import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";
import {
  createRequestLogger,
  getDurationMs,
  serializeError,
} from "@/lib/logger";

const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: "File size should be less than 5MB",
    })
    .refine((file) => ["image/jpeg", "image/png"].includes(file.type), {
      message: "File type should be JPEG or PNG",
    }),
});

export function POST(request: Request) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "api.files.upload.post",
  });

  return requestLogger.run(async () => {
    const session = await auth();

    if (!session) {
      requestLogger.logger.warn(
        "Upload request rejected because user is unauthorized",
        {
          durationMs: getDurationMs(startedAt),
        }
      );
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (request.body === null) {
      requestLogger.logger.warn(
        "Upload request rejected because body is empty",
        {
          userId: session.user?.id,
          durationMs: getDurationMs(startedAt),
        }
      );
      return new Response("Request body is empty", { status: 400 });
    }

    try {
      const formData = await request.formData();
      const file = formData.get("file") as Blob;

      if (!file) {
        requestLogger.logger.warn(
          "Upload request rejected because no file was provided",
          {
            userId: session.user?.id,
            durationMs: getDurationMs(startedAt),
          }
        );
        return NextResponse.json(
          { error: "No file uploaded" },
          { status: 400 }
        );
      }

      const validatedFile = FileSchema.safeParse({ file });

      if (!validatedFile.success) {
        const errorMessage = validatedFile.error.issues
          .map((error) => error.message)
          .join(", ");

        requestLogger.logger.warn(
          "Upload request rejected because file validation failed",
          {
            userId: session.user?.id,
            issues: validatedFile.error.issues,
            durationMs: getDurationMs(startedAt),
          }
        );
        return NextResponse.json({ error: errorMessage }, { status: 400 });
      }

      const filename = (formData.get("file") as File).name;
      const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileBuffer = await file.arrayBuffer();

      requestLogger.logger.info("Upload request accepted", {
        userId: session.user?.id,
        filename: safeName,
        contentType: file.type,
        fileSize: file.size,
      });

      try {
        const data = await put(`${safeName}`, fileBuffer, {
          access: "public",
        });

        requestLogger.logger.info("Upload request completed", {
          userId: session.user?.id,
          filename: safeName,
          durationMs: getDurationMs(startedAt),
          url: data.url,
        });
        return NextResponse.json(data);
      } catch (error) {
        requestLogger.logger.error("Blob upload failed", {
          userId: session.user?.id,
          filename: safeName,
          durationMs: getDurationMs(startedAt),
          error: serializeError(error),
        });
        return NextResponse.json({ error: "Upload failed" }, { status: 500 });
      }
    } catch (error) {
      requestLogger.logger.error(
        "Upload request failed while processing form data",
        {
          userId: session.user?.id,
          durationMs: getDurationMs(startedAt),
          error: serializeError(error),
        }
      );
      return NextResponse.json(
        { error: "Failed to process request" },
        { status: 500 }
      );
    }
  });
}
