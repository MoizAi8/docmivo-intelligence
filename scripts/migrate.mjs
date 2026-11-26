import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { loadEnvFile } from "node:process";
import pg from "pg";

async function migrate() {
  try { loadEnvFile(); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!process.env.DIRECT_DATABASE_URL) {
    try { loadEnvFile(".env.local"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!process.env.DIRECT_DATABASE_URL) throw new Error("DIRECT_DATABASE_URL is required");
  const db = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL, connectionTimeoutMillis: 12_000, enableChannelBinding: true });
  await db.connect();
  try {
    await db.query("SELECT pg_advisory_lock(188938401)");
    await db.query("CREATE TABLE IF NOT EXISTS docmivo_migrations(name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const directory = new URL("../db/migrations/", import.meta.url);
    for (const name of (await readdir(directory)).filter(name => /^\d{3}_.+\.sql$/.test(name)).sort()) {
      const sql = await readFile(new URL(name, directory), "utf8");
      const digest = createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
      const before = await db.query("SELECT digest FROM docmivo_migrations WHERE name=$1", [name]);
      if (before.rowCount) {
        if (before.rows[0].digest !== digest) throw new Error("Migration checksum mismatch");
        console.log("Verified", name);
        continue;
      }
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query("INSERT INTO docmivo_migrations(name,digest) VALUES ($1,$2)", [name,digest]);
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
      console.log("Applied", name);
    }
  } finally { await db.end(); }
}
migrate().catch(error => {
  const code = /^[A-Z0-9_]+$/.test(error.code ?? "") ? " (" + error.code + ")" : "";
  console.error("Database migration failed" + code);
  process.exitCode = 1;
});
