import { createHash } from "node:crypto";
import { authentication } from "@/server/auth/config";
import { body, headers, HttpError, route, verifyOrigin } from "@/server/db/http";
import { transaction } from "@/server/db/pool";
import { reserve } from "@/server/quotas/usage";

export const runtime = "nodejs";
function handle(request: Request) {
  return route(async () => {
    verifyOrigin(request);
    let bounded = request;
    if (request.method === "POST") {
      const action = new URL(request.url).pathname.split("/").at(-2);
      const bytes = await body(request, 16_384);
      if (action === "sign-in" || action === "sign-up") {
        const forwarded = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : null;
        const fingerprint = createHash("sha256").update(forwarded || "local").digest("hex");
        await transaction(async db => {
          await reserve(db, "auth-global", "auth", 120, "minute");
          await reserve(db, fingerprint, "auth", 12, "minute");
        });
      }
      bounded = new Request(request.url, { method: request.method, headers: request.headers, body: new Uint8Array(bytes) });
    }
    if (!bounded.url) throw new HttpError(400,"INVALID_INPUT","Invalid request.");
    const response = await authentication().handler(bounded);
    for (const [key,value] of Object.entries(headers)) response.headers.set(key,value);
    return response;
  });
}
export const GET = handle;
export const POST = handle;
