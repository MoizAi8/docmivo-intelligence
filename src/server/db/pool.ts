import "server-only";
import pg, { type PoolClient } from "pg";

let pool: pg.Pool | undefined;
export function database() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Database unavailable");
  return pool ??= new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 6000, enableChannelBinding: true, allowExitOnIdle: true });
}

export async function transaction<T>(run: (db: PoolClient) => Promise<T>, workspace?: string) {
  const db = await database().connect();
  let invalid: Error | undefined;
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL statement_timeout = '6000ms'");
    if (workspace) await db.query("SELECT set_config('docmivo.workspace',$1,true)", [workspace]);
    const result = await run(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    try { await db.query("ROLLBACK"); } catch { invalid = new Error("Transaction connection lost"); }
    throw error;
  } finally { db.release(invalid); }
}
