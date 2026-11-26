import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { betterAuth } from "better-auth";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { database } from "@/server/db/pool";

export function appOrigin() {
  return process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL
    : process.env.APP_URL || "http://localhost:3000";
}

export function inviteMatches(input: string | null, secret = process.env.REGISTRATION_INVITE) {
  if (!input || !secret || secret.length < 32 || input.length > 160) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(input), digest(secret));
}

function initializeAuth() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Auth unavailable");
  return betterAuth({
    appName: "Docmivo",
    baseURL: appOrigin(),
    secret,
    database: database(),
    emailAndPassword: { enabled: true, minPasswordLength: 12, maxPasswordLength: 128 },
    advanced: { database: { generateId: "uuid" }, useSecureCookies: appOrigin().startsWith("https:") },
    session: { expiresIn: 604800, updateAge: 86400 },
    rateLimit: { enabled: false },
    hooks: { before: createAuthMiddleware(async context => {
      if (context.path === "/sign-up/email" && !inviteMatches(context.headers?.get("x-docmivo-invite") ?? null)) {
        throw new APIError("FORBIDDEN", { message: "A valid Docmivo invite is required." });
      }
    }) },
    logger: { disabled: true }
  });
}

let auth: ReturnType<typeof initializeAuth> | undefined;
export function authentication() { return auth ??= initializeAuth(); }
