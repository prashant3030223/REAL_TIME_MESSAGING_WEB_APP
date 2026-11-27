import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { applyDatabaseMigrations } from "../../apps/api/src/db/migrate.js";

test("SQL migrations start with executable statements, not display headers", async () => {
  const migrationDirectory = resolve("apps/api/src/db/migrations");
  const filenames = (await readdir(migrationDirectory)).filter((filename) => filename.endsWith(".sql"));

  for (const filename of filenames) {
    const sql = await readFile(resolve(migrationDirectory, filename), "utf8");
    assert.doesNotMatch(sql, /^Showing lines \d+-\d+ of \d+\r?\n/, filename);
    const firstStatement = sql
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")
      .trimStart();
    assert.match(firstStatement, /^(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|COMMENT|SET|DO|BEGIN|GRANT|REVOKE)\b/i, filename);
  }
});

test("API startup migrations add per-member conversation lock settings", async () => {
  const appliedMigrations = new Map<string, string>([
    ["0001_identity_sessions.sql", "previous-checksum"],
    ["0002_messaging_and_calls.sql", "previous-checksum"],
    ["0003_phone_auth_and_otp.sql", "previous-checksum"],
    ["0004_persistent_message_metadata.sql", "previous-checksum"],
    ["0005_profile_photo_protection.sql", "previous-checksum"],
    ["0006_scheduled_messages.sql", "previous-checksum"],
  ]);
  const migrationSql: string[] = [];
  let released = false;
  const client = {
    query: async (query: string, values: unknown[] = []) => {
      if (query.includes("SELECT checksum FROM schema_migrations")) {
        const name = values[0] as string;
        const checksum = appliedMigrations.get(name);
        return {
          rows: checksum ? [{ checksum }] : [],
          rowCount: checksum ? 1 : 0,
        };
      }
      if (query.includes("INSERT INTO schema_migrations")) {
        appliedMigrations.set(values[0] as string, values[1] as string);
        return { rows: [], rowCount: 1 };
      }
      if (query.includes("ALTER TABLE app_conversation_members")) {
        migrationSql.push(query);
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {
      released = true;
    },
  };
  const database = {
    connect: async () => client,
  } as unknown as Pool;

  await applyDatabaseMigrations(database);

  assert.equal(released, true);
  assert.ok(appliedMigrations.has("0007_conversation_lock.sql"));
  assert.equal(appliedMigrations.has("0003_phone_auth.sql"), false);
  assert.equal(migrationSql.length, 1);
  assert.match(migrationSql[0] ?? "", /ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false/);
});
