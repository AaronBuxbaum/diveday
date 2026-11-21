import type { DbExecutor } from "@/db/client";
import { issueMagicSignIn } from "@/db/magic-sign-in";
import { sendNotification } from "@/db/notifications";
import { toDiverLocale } from "@/i18n/settings";
import { type NotificationProvider, publicAppUrl } from "@/lib/notifications";

/** The deferred send's entire account/recipient decision, with a provider seam for isolated tests. */
export async function sendMagicSignInMail(
  db: DbExecutor,
  email: string,
  provider?: NotificationProvider,
) {
  const origin = publicAppUrl();
  if (!origin) return;
  const issued = await issueMagicSignIn(db, email);
  if (!issued) return;
  const account = issued.contact;
  await sendNotification(
    db,
    {
      kind: "magic_sign_in_request",
      userAccountId: account.id,
      tokenId: issued.tokenId,
      shopId: account.shopId,
      to: account.email,
      locale: toDiverLocale(account.defaultLocale),
      ownerName: account.ownerName,
      signInUrl: new URL(`/email-sign-in/${issued.token}`, `${origin}/`).toString(),
      expiresAt: issued.expiresAt,
      timezone: account.timezone,
    },
    provider,
  ).catch(() => ({ status: "failed" as const }));
}
