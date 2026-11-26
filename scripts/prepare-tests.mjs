import { spawnSync } from "node:child_process";
import pg from "pg";

const testUrl=process.env.TEST_DATABASE_URL;
export const runtimePassword="docmivo-local-test-runtime-password";
export function requireLocalTestUrl(value=testUrl) {
  const parsed=new URL(value ?? "");
  if (!["localhost","127.0.0.1","[::1]"].includes(parsed.hostname) || !/\/\w+_test$/.test(parsed.pathname)) {
    throw new Error("An isolated loopback PostgreSQL database ending in _test is required.");
  }
  return parsed;
}
async function prepare() {
  requireLocalTestUrl();
  const db=new pg.Client({connectionString:testUrl});
  await db.connect();
  try {
    const existing=await db.query("SELECT 1 FROM pg_roles WHERE rolname='docmivo_runtime'");
    if (!existing.rowCount) await db.query("CREATE ROLE docmivo_runtime LOGIN PASSWORD '"+runtimePassword+"'");
  } finally {await db.end();}
  const result=spawnSync(process.execPath,["scripts/migrate.mjs"],{stdio:"inherit",env:{...process.env,DIRECT_DATABASE_URL:testUrl}});
  if (result.status!==0) process.exitCode=1;
}
prepare().catch(()=>{console.error("Disposable database setup failed.");process.exitCode=1;});
