import pino from "pino";
import type { AppConfig } from "./config.js";

export type AppLogger = pino.Logger;

export function createLogger(config?: Partial<AppConfig>): AppLogger {
  const isTest = config?.nodeEnv === "test";
  return pino({
    level: isTest ? "silent" : (config?.logLevel || "info"),
  });
}
