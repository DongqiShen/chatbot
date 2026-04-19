import { isDevelopmentEnvironment } from "@/lib/constants";

export type LogFields = Record<string, unknown>;

type LogLevel = "debug" | "info" | "warn" | "error";
type LogProfile = "development" | "production" | "diagnostic";

type FileSink = {
  append(entry: string): Promise<void>;
};

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_TOKEN_PATTERN =
  /\b(?:sk|rk|pk|tok|token|bearer)-[A-Za-z0-9._-]+\b/gi;
const LONG_SECRET_PATTERN = /\b[A-Za-z0-9_-]{24,}\b/g;
const DEFAULT_LOG_SUMMARY_LIMIT = 500;
const DEFAULT_LOG_PROFILE: LogProfile = isDevelopmentEnvironment
  ? "development"
  : "production";

let fileSinkPromise: Promise<FileSink | null> | null = null;
let fileWriteQueue: Promise<void> = Promise.resolve();

function isServerRuntime() {
  return typeof window === "undefined";
}

function getLogProfile(): LogProfile {
  const profile = process.env.LOG_PROFILE?.toLowerCase();

  if (
    profile === "development" ||
    profile === "production" ||
    profile === "diagnostic"
  ) {
    return profile;
  }

  return DEFAULT_LOG_PROFILE;
}

function getConfiguredLogLevel(): LogLevel {
  const configuredLevel = process.env.LOG_LEVEL?.toLowerCase();

  if (
    configuredLevel === "debug" ||
    configuredLevel === "info" ||
    configuredLevel === "warn" ||
    configuredLevel === "error"
  ) {
    return configuredLevel;
  }

  switch (getLogProfile()) {
    case "development":
      return "debug";
    case "diagnostic":
      return "info";
    default:
      return "info";
  }
}

function shouldLog(level: LogLevel) {
  return LOG_LEVELS[level] >= LOG_LEVELS[getConfiguredLogLevel()];
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    };
  }

  if (typeof error === "object" && error !== null) {
    return error;
  }

  return { value: error };
}

function isEnabled(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function getProfileDefault(_flag: "userMessages" | "modelIO" | "toolCalls") {
  const profile = getLogProfile();

  if (profile === "development") {
    return true;
  }

  if (profile === "diagnostic") {
    return true;
  }

  return false;
}

export function shouldLogUserMessages() {
  if (typeof process.env.LOG_USER_MESSAGES !== "undefined") {
    return isEnabled(process.env.LOG_USER_MESSAGES);
  }

  return getProfileDefault("userMessages");
}

export function shouldLogModelIO() {
  if (typeof process.env.LOG_MODEL_IO !== "undefined") {
    return isEnabled(process.env.LOG_MODEL_IO);
  }

  return getProfileDefault("modelIO");
}

export function shouldLogToolCalls() {
  if (typeof process.env.LOG_TOOL_CALLS !== "undefined") {
    return isEnabled(process.env.LOG_TOOL_CALLS);
  }

  return getProfileDefault("toolCalls");
}

export function redactSensitiveText(value: string) {
  return value
    .replace(EMAIL_PATTERN, "[redacted-email]")
    .replace(BEARER_TOKEN_PATTERN, "[redacted-token]")
    .replace(LONG_SECRET_PATTERN, (match) => {
      if (/^\d+$/.test(match)) {
        return match;
      }

      return "[redacted-secret]";
    });
}

export function summarizeText(
  value: string,
  options: { maxLength?: number } = {}
) {
  const maxLength = options.maxLength ?? DEFAULT_LOG_SUMMARY_LIMIT;
  const normalized = redactSensitiveText(value).replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}…`;
}

export function summarizeMessageParts(parts: unknown) {
  if (!Array.isArray(parts)) {
    return [];
  }

  return parts
    .map((part) => {
      if (typeof part !== "object" || part === null) {
        return null;
      }

      const record = part as Record<string, unknown>;

      if (record.type === "text" && typeof record.text === "string") {
        return {
          type: "text",
          text: summarizeText(record.text),
        };
      }

      return {
        type: typeof record.type === "string" ? record.type : "unknown",
      };
    })
    .filter(Boolean);
}

export function summarizeUnknown(
  value: unknown,
  options: { maxLength?: number } = {}
): unknown {
  if (typeof value === "string") {
    return summarizeText(value, options);
  }

  try {
    return JSON.parse(
      summarizeText(JSON.stringify(sanitizeValue(value)), options)
    );
  } catch {
    return summarizeText(String(value), options);
  }
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)])
        .filter(([, nestedValue]) => typeof nestedValue !== "undefined")
    );
  }

  return value;
}

function sanitizeFields(fields: LogFields = {}) {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, sanitizeValue(value)])
      .filter(([, value]) => typeof value !== "undefined")
  );
}

function writeConsole(level: LogLevel, serializedRecord: string) {
  if (level === "debug") {
    console.debug(serializedRecord);
    return;
  }

  if (level === "info") {
    console.info(serializedRecord);
    return;
  }

  if (level === "warn") {
    console.warn(serializedRecord);
    return;
  }

  console.error(serializedRecord);
}

function reportFileSinkError(message: string, error: unknown) {
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      message,
      service: "chatbot",
      error: sanitizeValue(error),
    })
  );
}

async function createFileSink(): Promise<FileSink | null> {
  if (!isServerRuntime()) {
    return null;
  }

  const logFile = process.env.LOG_FILE?.trim();
  if (!logFile) {
    return null;
  }

  try {
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier);"
    ) as (specifier: string) => Promise<any>;

    const [{ appendFile, mkdir }, pathModule] = await Promise.all([
      dynamicImport("node:fs/promises"),
      dynamicImport("node:path"),
    ]);

    const directory = pathModule.dirname(logFile);
    await mkdir(directory, { recursive: true });

    return {
      async append(entry: string) {
        await appendFile(logFile, `${entry}\n`, "utf8");
      },
    };
  } catch (error) {
    reportFileSinkError("Failed to initialize file log sink", error);
    return null;
  }
}

function getFileSink() {
  if (!fileSinkPromise) {
    fileSinkPromise = createFileSink();
  }

  return fileSinkPromise;
}

function scheduleFileWrite(serializedRecord: string) {
  if (!isServerRuntime() || !process.env.LOG_FILE?.trim()) {
    return;
  }

  fileWriteQueue = fileWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const fileSink = await getFileSink();

      if (!fileSink) {
        return;
      }

      await fileSink.append(serializedRecord);
    })
    .catch((error) => {
      reportFileSinkError("Failed to write log entry to file", error);
    });
}

function writeLog(level: LogLevel, message: string, fields?: LogFields) {
  if (!shouldLog(level)) {
    return;
  }

  const baseRecord = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: "chatbot",
  };

  const record = {
    ...baseRecord,
    ...sanitizeFields(fields),
  };

  const serializedRecord = JSON.stringify(record);
  writeConsole(level, serializedRecord);
  scheduleFileWrite(serializedRecord);
}

export type Logger = {
  child(bindings: LogFields): Logger;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
};

export function createLogger(bindings: LogFields = {}): Logger {
  const mergedBindings = sanitizeFields(bindings);

  return {
    child(childBindings) {
      return createLogger({
        ...mergedBindings,
        ...sanitizeFields(childBindings),
      });
    },
    debug(message, fields) {
      writeLog("debug", message, { ...mergedBindings, ...fields });
    },
    info(message, fields) {
      writeLog("info", message, { ...mergedBindings, ...fields });
    },
    warn(message, fields) {
      writeLog("warn", message, { ...mergedBindings, ...fields });
    },
    error(message, fields) {
      writeLog("error", message, { ...mergedBindings, ...fields });
    },
  };
}

export const logger = createLogger();

export function getDurationMs(startedAt: number) {
  return Date.now() - startedAt;
}

export function runWithLogContext<T>(_context: LogFields, fn: () => T) {
  return fn();
}

export function getRequestId(request: Request) {
  return (
    request.headers.get("x-request-id") ||
    request.headers.get("x-vercel-id") ||
    crypto.randomUUID()
  );
}

export function createRequestLogger(
  request: Request,
  bindings: LogFields = {}
) {
  const url = new URL(request.url);
  const requestId = getRequestId(request);
  const context = sanitizeFields({
    requestId,
    method: request.method,
    path: url.pathname,
    ...bindings,
  });

  return {
    requestId,
    context,
    logger: createLogger(context),
    run<T>(fn: () => T) {
      return runWithLogContext(context, fn);
    },
  };
}
