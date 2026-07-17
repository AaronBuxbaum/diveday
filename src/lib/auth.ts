import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { getDb } from "@/db/client";
import { authConfig } from "@/lib/auth.config";
import { verifyCredentials } from "@/lib/credentials";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const db = await getDb();
        return verifyCredentials(db, parsed.data.email, parsed.data.password);
      },
    }),
  ],
});
