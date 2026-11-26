import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { appOrigin, authentication } from "@/server/auth/config";
import { transaction } from "@/server/db/pool";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const notFound = () => new HttpError(404, "NOT_FOUND", "This item is unavailable in your workspace.");
export const invalid = (message: string) => new HttpError(400, "INVALID_INPUT", message);
export const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
export const respond = (data: unknown, status = 200) => Response.json({ data, requestId: randomUUID() }, { status, headers });

export async function route(run: () => Promise<Response>) {
  try { return await run(); } catch (error) {
    let failure = error instanceof HttpError ? error : new HttpError(503, "UNAVAILABLE", "The service is temporarily unavailable.");
    if (error instanceof ZodError || error instanceof SyntaxError) failure = invalid("Check the request fields and try again.");
    const pg = error as { code?: string };
    if (pg?.code === "23505") failure = new HttpError(409,"CONFLICT","This item already exists.");
    if (pg?.code === "23503") failure = notFound();
    return Response.json({ error: { code: failure.code, message: failure.message }, requestId: randomUUID() }, { status: failure.status, headers });
  }
}

export function verifyOrigin(request: Request) {
  if (["GET","HEAD","OPTIONS"].includes(request.method)) return;
  if (request.headers.get("origin") !== appOrigin()) {
    throw new HttpError(403, "ORIGIN", "This request must originate from Docmivo.");
  }
}

export async function body(request: Request, limit = 32_768) {
  if (Number(request.headers.get("content-length")) > limit) throw new HttpError(413,"TOO_LARGE","The request exceeds the size limit.");
  const reader = request.body?.getReader();
  if (!reader) throw invalid("A request body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        void reader.cancel().catch(() => {});
        throw new HttpError(413,"TOO_LARGE","The request exceeds the size limit.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

export async function json(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw invalid("Use a JSON request body.");
  return JSON.parse((await body(request)).toString("utf8"));
}

export async function session(request: Request) {
  const current = await authentication().api.getSession({ headers: request.headers });
  if (!current) throw new HttpError(401,"UNAUTHENTICATED","Sign in to open your workspace.");
  return current.user;
}

export async function prepareWorkspace(id: string) {
  await transaction(async db => { await db.query("INSERT INTO workspaces(id) VALUES ($1) ON CONFLICT DO NOTHING", [id]); }, id);
}
