import process from "node:process";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  context?: LogContext;
}

export interface Logger {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
  child: (scope: string, context?: LogContext) => Logger;
}

export interface CreateLoggerOptions {
  scope?: string;
  level?: LogLevel;
  context?: LogContext;
  stream?: NodeJS.WritableStream;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const shouldLog = (minimumLevel: LogLevel, level: LogLevel): boolean => {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minimumLevel];
};

export const createLogger = (options: CreateLoggerOptions = {}): Logger => {
  const scope = options.scope ?? "airlock";
  const minimumLevel = options.level ?? "info";
  const baseContext = options.context ?? {};
  const stream = options.stream ?? process.stderr;

  const write = (level: LogLevel, message: string, context?: LogContext): void => {
    if (!shouldLog(minimumLevel, level)) {
      return;
    }

    const combinedContext = { ...baseContext, ...(context ?? {}) };
    const entryBase: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      scope,
      message
    };
    const entry = Object.keys(combinedContext).length > 0 ? { ...entryBase, context: combinedContext } : entryBase;

    stream.write(`${JSON.stringify(entry)}\n`);
  };

  return {
    debug: (message: string, context?: LogContext): void => {
      write("debug", message, context);
    },
    info: (message: string, context?: LogContext): void => {
      write("info", message, context);
    },
    warn: (message: string, context?: LogContext): void => {
      write("warn", message, context);
    },
    error: (message: string, context?: LogContext): void => {
      write("error", message, context);
    },
    child: (childScope: string, childContext?: LogContext): Logger => {
      return createLogger({
        scope: `${scope}:${childScope}`,
        level: minimumLevel,
        context: { ...baseContext, ...(childContext ?? {}) },
        stream
      });
    }
  };
};
