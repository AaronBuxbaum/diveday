import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { getDb } from "@/db/client";
import { trackEvent } from "@/lib/analytics";
import { authConfig } from "@/lib/auth.config";
import { logAuthError } from "@/lib/auth-logger";
import { verifyCredentials } from "@/lib/credentials";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // Only `error` is overridden; `warn` and `debug` keep the built-in logger.
  // It belongs here rather than in `auth.config.ts` because that config is the
  // edge-safe half — `logAuthError` writes through `src/lib/log.ts`, which
  // buffers for CloudWatch — and because a refused credential can only ever be
  // thrown by the provider below, which is node-runtime only. See that module
  // for why an ordinary wrong password is a `warn` with a counter behind it.
  logger: { error: logAuthError },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      // NextAuth invokes this callback for every credentials sign-in
      // attempt, whether it came through our sign-in page's server action or
      // a direct POST to /api/auth/callback/credentials — so this is the one
      // chokepoint that actually can't be bypassed (CR-013). The sign-in
      // page also rate-limits for a friendlier redirect on the normal path;
      // this is the authoritative check.
      async authorize(credentials, request) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const ip = await clientIp({ get: (name) => request.headers.get(name) });
        const [byIp, byEmail] = await Promise.all([
          checkRateLimit(rateLimitKey("sign-in-ip", ip), RATE_LIMITS.signInByIp),
          checkRateLimit(
            rateLimitKey("sign-in-email", parsed.data.email.toLowerCase()),
            RATE_LIMITS.signInByEmail,
          ),
        ]);
        if (!byIp.allowed || !byEmail.allowed) {
          // Fire-and-forget: telemetry must never add latency to the sign-in
          // chokepoint, and trackEvent already swallows its own errors.
          void trackEvent({ name: "sign_in_attempted", outcome: "rate_limited" });
          return null;
        }
        const db = await getDb();
        const person = await verifyCredentials(db, parsed.data.email, parsed.data.password);
        void trackEvent({
          name: "sign_in_attempted",
          outcome: person ? "success" : "invalid_credentials",
        });
        return person;
      },
    }),
  ],
});
