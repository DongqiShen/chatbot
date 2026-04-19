import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/app/(auth)/auth";
import { isDevelopmentEnvironment } from "@/lib/constants";
import {
  createRequestLogger,
  getDurationMs,
  serializeError,
} from "@/lib/logger";

export function GET(request: Request) {
  const startedAt = Date.now();
  const requestLogger = createRequestLogger(request, {
    route: "auth.guest.get",
  });

  return requestLogger.run(async () => {
    const { searchParams } = new URL(request.url);
    const rawRedirect = searchParams.get("redirectUrl") || "/";
    const redirectUrl =
      rawRedirect.startsWith("/") && !rawRedirect.startsWith("//")
        ? rawRedirect
        : "/";

    requestLogger.logger.info("Guest auth request received", {
      redirectUrl,
    });

    try {
      const token = await getToken({
        req: request,
        secret: process.env.AUTH_SECRET,
        secureCookie: !isDevelopmentEnvironment,
      });

      if (token) {
        const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
        const response = NextResponse.redirect(
          new URL(`${base}/`, request.url)
        );
        requestLogger.logger.info(
          "Guest auth skipped because user already has a token",
          {
            statusCode: response.status,
            durationMs: getDurationMs(startedAt),
          }
        );
        return response;
      }

      requestLogger.logger.info("Starting guest sign-in redirect", {
        durationMs: getDurationMs(startedAt),
      });
      return signIn("guest", { redirect: true, redirectTo: redirectUrl });
    } catch (error) {
      requestLogger.logger.error("Guest auth route failed", {
        durationMs: getDurationMs(startedAt),
        error: serializeError(error),
      });
      throw error;
    }
  });
}
