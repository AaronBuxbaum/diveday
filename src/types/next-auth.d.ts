import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/authz";

declare module "next-auth" {
  interface Session {
    user: {
      personId: string;
      shopId: string;
      shopSlug: string;
      roles: Role[];
    } & DefaultSession["user"];
  }

  interface User {
    personId: string;
    shopId: string;
    shopSlug: string;
    roles: Role[];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    personId?: string;
    shopId?: string;
    shopSlug?: string;
    roles?: Role[];
  }
}
