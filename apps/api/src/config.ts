import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().trim().min(1).optional(),
  DATABASE_SSL: z.preprocess((val) => typeof val === "string" ? val.toLowerCase() : val, z.enum(["true", "false", "1", "0"])).optional(),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).optional(),
  CORS_ORIGIN: z.string().trim().min(1).optional(),
  TRUST_PROXY: z.string().trim().min(1).optional(),
  STATIC_DIR: z.string().trim().min(1).optional(),
  VAPID_PUBLIC_KEY: z.string().trim().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().trim().min(1).optional(),
  VAPID_SUBJECT: z.string().trim().min(1).optional(),
}).refine(
  (value) => Boolean(value.VAPID_PUBLIC_KEY) === Boolean(value.VAPID_PRIVATE_KEY),
  {
    message: "VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured together.",
    path: ["VAPID_PRIVATE_KEY"],
  },
);

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  databaseUrl?: string;
  databaseSsl?: boolean;
  databaseMaxConnections?: number;
  corsOrigin?: string;
  trustProxy?: boolean | number | string;
  staticDir?: string;
  webPushPublicKey?: string;
  webPushPrivateKey?: string;
  webPushSubject?: string;
};

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid application configuration: ${details}`);
  }

  if (parsed.data.NODE_ENV === "production" && !parsed.data.DATABASE_URL) {
    throw new Error("Invalid application configuration: DATABASE_URL is required in production.");
  }

  const {
    NODE_ENV,
    PORT,
    LOG_LEVEL,
    DATABASE_URL,
    DATABASE_SSL,
    DATABASE_MAX_CONNECTIONS,
    CORS_ORIGIN,
    TRUST_PROXY,
    STATIC_DIR,
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
    VAPID_SUBJECT,
  } = parsed.data;

  const trustProxyParsed =
    TRUST_PROXY !== undefined
      ? TRUST_PROXY.toLowerCase() === "true"
        ? true
        : TRUST_PROXY.toLowerCase() === "false"
          ? false
          : !isNaN(Number(TRUST_PROXY))
            ? Number(TRUST_PROXY)
            : TRUST_PROXY
      : NODE_ENV === "production"
        ? 1
        : undefined;

  const sslParsed =
    DATABASE_SSL !== undefined
      ? DATABASE_SSL === "true" || DATABASE_SSL === "1"
      : undefined;

  return {
    nodeEnv: NODE_ENV,
    port: PORT,
    logLevel: LOG_LEVEL,
    ...(DATABASE_URL !== undefined ? { databaseUrl: DATABASE_URL } : {}),
    ...(sslParsed !== undefined ? { databaseSsl: sslParsed } : {}),
    ...(DATABASE_MAX_CONNECTIONS !== undefined ? { databaseMaxConnections: DATABASE_MAX_CONNECTIONS } : {}),
    ...(CORS_ORIGIN !== undefined ? { corsOrigin: CORS_ORIGIN } : {}),
    ...(trustProxyParsed !== undefined ? { trustProxy: trustProxyParsed } : {}),
    ...(STATIC_DIR !== undefined ? { staticDir: STATIC_DIR } : {}),
    ...(VAPID_PUBLIC_KEY !== undefined ? { webPushPublicKey: VAPID_PUBLIC_KEY } : {}),
    ...(VAPID_PRIVATE_KEY !== undefined ? { webPushPrivateKey: VAPID_PRIVATE_KEY } : {}),
    ...(VAPID_SUBJECT !== undefined ? { webPushSubject: VAPID_SUBJECT } : {}),
  };
}
