import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { getDb } from "@/db/client";
import { authConfig } from "@/lib/auth.config";
import { verifyCredentials } from "@/lib/credentials";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
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
        const byIp = checkRateLimit(rateLimitKey("sign-in-ip", ip), RATE_LIMITS.signInByIp);
        const byEmail = checkRateLimit(
          rateLimitKey("sign-in-email", parsed.data.email.toLowerCase()),
          RATE_LIMITS.signInByEmail,
        );
        if (!byIp.allowed || !byEmail.allowed) return null;
        const db = await getDb();
        return verifyCredentials(db, parsed.data.email, parsed.data.password);
      },
    }),
  ],
});
