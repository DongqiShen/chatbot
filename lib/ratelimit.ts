import { createClient } from "redis";

import { isProductionEnvironment } from "@/lib/constants";
import { ChatbotError } from "@/lib/errors";
import { logger, serializeError } from "@/lib/logger";

const MAX_MESSAGES = 1000;
const TTL_SECONDS = 60 * 60;

let client: ReturnType<typeof createClient> | null = null;
const rateLimitLogger = logger.child({ component: "ratelimit" });

function getClient() {
  if (!client && process.env.REDIS_URL) {
    client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (error) => {
      rateLimitLogger.error("Redis client emitted an error", {
        error: serializeError(error),
      });
    });
    client.connect().catch((error) => {
      rateLimitLogger.error("Redis client failed to connect", {
        error: serializeError(error),
      });
      client = null;
    });
  }
  return client;
}

export async function checkIpRateLimit(ip: string | undefined) {
  if (!isProductionEnvironment || !ip) {
    rateLimitLogger.debug("Skipping IP rate limit check", {
      reason: isProductionEnvironment ? "missing-ip" : "non-production",
    });
    return;
  }

  const redis = getClient();
  if (!redis?.isReady) {
    rateLimitLogger.warn(
      "Skipping IP rate limit check because Redis is unavailable",
      {
        ip,
      }
    );
    return;
  }

  try {
    const key = `ip-rate-limit:${ip}`;
    const [count] = await redis
      .multi()
      .incr(key)
      .expire(key, TTL_SECONDS, "NX")
      .exec();

    if (typeof count === "number" && count > MAX_MESSAGES) {
      rateLimitLogger.warn("IP rate limit exceeded", {
        ip,
        count,
        maxMessages: MAX_MESSAGES,
        ttlSeconds: TTL_SECONDS,
      });
      throw new ChatbotError("rate_limit:chat");
    }

    rateLimitLogger.debug("IP rate limit check passed", {
      ip,
      count,
      maxMessages: MAX_MESSAGES,
    });
  } catch (error) {
    if (error instanceof ChatbotError) {
      throw error;
    }

    rateLimitLogger.error("IP rate limit check failed", {
      ip,
      error: serializeError(error),
    });
  }
}
