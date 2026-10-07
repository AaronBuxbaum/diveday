import { previewWeeklyDigest } from "@/db/weekly-digest";
import { recipientLocale } from "@/lib/notifications";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { wrapEmailHtml } from "@/lib/notifications/email";
import { messageFor } from "@/lib/notifications/render";
import { weeklyDigestQuietWeekEmail } from "@/lib/notifications/weekly-digest-email";
import { isLiveShopStaff, requireShopSurface } from "@/lib/session";

/**
 * **This week's Monday email, as the signed-in staffer would get it** — the
 * same document the pass would send, rendered from the same reads, opened in
 * a tab of its own from their email settings. It is how a demo shop's email is
 * seen at all: demo shops never send (`sendDueWeeklyDigests`).
 *
 * Read-only: no claim, no opt-out token, nothing written. Its "stop these"
 * link is the settings page it was opened from. A week the pass would skip
 * renders one sentence saying so rather than an empty email.
 *
 * A Route Handler rather than a page because the answer is a whole HTML
 * document, chrome and all, which is what an inbox would render.
 */
export async function GET(request: Request, { params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const { db, shop, session } = await requireShopSurface(shopSlug);
  if (!(await isLiveShopStaff(db, shop.id, session))) return new Response(null, { status: 404 });

  const origin = publicAppUrl() ?? new URL(request.url).origin;
  const preview = await previewWeeklyDigest(db, {
    shop,
    personId: session.user.personId,
    origin,
  });
  const html = preview
    ? messageFor(preview).html
    : wrapEmailHtml(
        weeklyDigestQuietWeekEmail({
          locale: recipientLocale(null, shop.defaultLocale),
          shopName: shop.name,
        }).html,
        { shopName: shop.name, locale: recipientLocale(null, shop.defaultLocale) },
      );
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      // The email's own markup, shown as a page: nothing in it needs a script.
      "content-security-policy":
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
      "x-robots-tag": "noindex",
    },
  });
}
