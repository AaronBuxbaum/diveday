import { previewWeeklyDigest } from "@/db/weekly-digest";
import { recipientLocale } from "@/lib/notifications";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { wrapEmailHtml } from "@/lib/notifications/email";
import { messageFor } from "@/lib/notifications/render";
import { weeklyDigestQuietWeekEmail } from "@/lib/notifications/weekly-digest-email";
import { isLiveShopStaff, requireShopSurface } from "@/lib/session";
import { staffShopName } from "../../../_components/staff-shop-name";

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
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ shopSlug: string }> },
) {
  const { shopSlug } = await params;
  const { db, shop, session } = await requireShopSurface(shopSlug);
  if (!(await isLiveShopStaff(db, shop.id, session))) return new Response(null, { status: 404 });

  // Every link in the email is built from the configured origin, never the
  // request's: a Host-header origin is how a link gets pointed at someone
  // else's server. A deploy without a valid one has no preview to give.
  const origin = publicAppUrl();
  if (!origin) return new Response(null, { status: 503 });
  // A minted demo's preview wears the visitor's own shop name (H-20261014-demo-wears-visitor-shop); this
  // document is rendered for their browser only and is never sent.
  const shopName = await staffShopName(shop);
  const preview = await previewWeeklyDigest(db, {
    shop: { ...shop, name: shopName },
    personId: session.user.personId,
    origin,
  });
  const html = preview
    ? messageFor(preview).html
    : wrapEmailHtml(
        weeklyDigestQuietWeekEmail({
          locale: recipientLocale(null, shop.defaultLocale),
          shopName,
        }).html,
        { shopName, locale: recipientLocale(null, shop.defaultLocale) },
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
