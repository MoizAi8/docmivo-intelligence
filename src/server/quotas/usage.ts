import "server-only";
import type { PoolClient } from "pg";
import { HttpError } from "@/server/db/http";

export function limit(name: string, fallback: number, ceiling: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value >= 1 ? Math.min(value, ceiling) : fallback;
}

export async function reserve(db: PoolClient, scope: string, kind: string, maximum: number, period: "minute" | "day" = "day") {
  const result = await db.query(`INSERT INTO usage_buckets(scope_key,period_start,kind,count)
    VALUES ($1,date_trunc($4,now(),'UTC'),$2,1)
    ON CONFLICT (scope_key,period_start,kind) DO UPDATE SET count=usage_buckets.count+1
    WHERE usage_buckets.count<$3 RETURNING count`, [scope,kind,maximum,period]);
  if (!result.rowCount) throw new HttpError(429,"RATE_LIMIT","Usage limit reached. Try again later.");
  return Number(result.rows[0].count);
}
