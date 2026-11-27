import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { parseConfig } from "../config.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
let migrationsDirectory = join(currentDir, "migrations");
if (!existsSync(migrationsDirectory)) {
  const fallbackSrc = resolve(currentDir, "../../src/db/migrations");
  const fallbackCwd = resolve(process.cwd(), "apps/api/src/db/migrations");
  if (existsSync(fallbackSrc)) {
    migrationsDirectory = fallbackSrc;
  } else if (existsSync(fallbackCwd)) {
    migrationsDirectory = fallbackCwd;
  }
}
const migrationNamePattern = /^\d{4}_[a-z0-9_]+\.sql$/;
// This alternate 0003 branch was superseded by 0003_phone_auth_and_otp.sql.
const retiredMigrations = new Set(["0003_phone_auth.sql"]);
const advisoryLockKey = 7_318_402_115;

export async function applyDatabaseMigrations(database: Pool) {
  const client = await database.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [advisoryLockKey]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((name) => migrationNamePattern.test(name) && !retiredMigrations.has(name))
      .sort();
    for (const name of files) {
      const sql = await readFile(join(migrationsDirectory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "SELECT checksum FROM schema_migrations WHERE name = $1",
        [name],
      );
      if (existing.rowCount) {
        if (existing.rows[0]?.checksum !== checksum) {
          console.warn(`Applied migration ${name} has a different checksum; leaving it untouched.`);
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
          [name, checksum],
        );
        await client.query("COMMIT");
        console.info(`Applied ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    console.info("Database migrations are up to date.");
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [advisoryLockKey]);
    } finally {
      client.release();
    }
  }
}

async function migrateFromCommandLine() {
  const config = parseConfig(process.env);
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to run database migrations.");
  }

  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
    ...(config.databaseSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  });
  try {
    await applyDatabaseMigrations(pool);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await migrateFromCommandLine();
}
