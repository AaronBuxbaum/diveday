import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { escapeHtml } from "@/lib/html";
import { publicAppUrl } from "@/lib/notifications";
import { FOUNDER_EMAIL } from "@/lib/platform-mail";
import { publicSchedulePath } from "@/lib/public-routes";
import { requireStaffSession } from "@/lib/session";
import { SnippetField } from "./SnippetField";

// `instant = true` asserts that navigating *into* this page paints
// immediately. It is not a claim that the route has a static shell: the staff
// shell layout declares `instant = false` (read its comment for why), so a
// cold, direct visit still blocks on the session and the shop row. What this
// validates is the navigation staff actually make all day — arriving from
// another `/shop` page, where that shell is already mounted and this
// segment's `loading.tsx` is what paints. See ADR 20260804-instant-navigation.
export const instant = true;

export const metadata: Metadata = { title: "Website embed — DiveDay" };

/**
 * Snippets a shop pastes into its own website — the piece FareHarbor's embed
 * generator covers and DiveDay didn't (docs ADR 20260726-schedule-embed).
 * Only the schedule/trip pages carry the framing exception src/proxy.ts grants
 * (`isEmbeddableShopRoute`), so every snippet here targets exactly those URLs.
 */
export default async function EmbedSettingsPage() {
  const session = await requireStaffSession();
  const db = await getDb();
  // Built from the staff member's own authorized shop, never the route's
  // shopSlug param — a stale or mismatched URL segment must never generate
  // a snippet that labels one shop's name on another shop's calendar.
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect("/");

  const t = staffTranslator(await requestLocale(shop.defaultLocale));

  const origin = publicAppUrl();
  const scheduleUrl = origin ? `${origin}${publicSchedulePath(shop.slug)}` : null;

  // Every other settings sub-page carries this; this one didn't, so the only
  // way out of it — including out of the not-configured state below, which is
  // the version a shop without a hosting address ever sees — was the browser's
  // own Back.
  const backToSettings = (
    <Link
      href={`/shop/${session.user.shopSlug}/settings`}
      className={buttonClass({ variant: "secondary", className: "text-foreground" })}
    >
      {t("settings.main.backToSettings")}
    </Link>
  );

  if (!scheduleUrl) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <ShopPageHeader
          eyebrow={t("settings.embed.eyebrow")}
          title={t("settings.embed.title")}
          actions={backToSettings}
        />
        <p className="rounded-lg bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
          {t("settings.embed.notConfigured", { email: FOUNDER_EMAIL })}
        </p>
      </main>
    );
  }

  const embedUrl = `${scheduleUrl}?embed=1`;
  const shopNameAttr = escapeHtml(shop.name);
  const bookButtonText = t("settings.embed.bookButton.buttonText");
  const attributionLinkText = t("settings.embed.calendarEmbed.attributionLinkText");
  // A crawlable backlink: `<a>` in the shop's *own* page HTML, outside the
  // iframe's document, so a search engine attributes it to the shop's page —
  // an equivalent link placed inside the iframe's own document would not
  // count, since crawlers don't fold iframe content into the parent page's
  // link graph (docs ADR 20260726-schedule-embed).
  const attributionParams = new URLSearchParams({
    utm_source: "embed",
    utm_medium: "widget",
    utm_campaign: shop.slug,
  });
  const attributionUrl = `${origin}/?${attributionParams.toString()}`;
  // #5b6f77 is the light-mode `--muted` token value (src/app/globals.css) —
  // same reasoning as the button snippet below: this renders on the shop's
  // own site, outside DiveDay's CSS, so it inlines the real color rather than
  // referencing the custom property. Kept small and unobtrusive on purpose.
  const iframeSnippet = `<iframe src="${embedUrl}" title="${shopNameAttr} — ${escapeHtml(bookButtonText)}" style="width:100%;max-width:720px;height:900px;border:0;border-radius:12px" loading="lazy"></iframe>
<a href="${attributionUrl}" target="_blank" rel="noopener" style="display:block;margin-top:6px;font:12px/1.4 system-ui,sans-serif;color:#5b6f77;text-decoration:none">${escapeHtml(attributionLinkText)}</a>`;
  // Deliberately the plain schedule URL, not the embed one: this is a link a
  // browser navigates to directly, never a frame, so it should land on the
  // full page — including for a shop that takes online payment, where a
  // hosted Stripe Checkout may refuse to render inside someone else's iframe.
  // #0e7490 is the light-mode `--primary` token value (src/app/globals.css) —
  // the snippet renders on the shop's own site, outside DiveDay's CSS, so it
  // has to inline the real color rather than reference the custom property.
  const buttonSnippet = `<a href="${scheduleUrl}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;background:#0e7490;color:#fff;font:600 15px/1 system-ui,sans-serif;text-decoration:none;border-radius:10px">${escapeHtml(bookButtonText)}</a>`;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow={t("settings.embed.eyebrow")}
        title={t("settings.embed.title")}
        description={t("settings.embed.description")}
        actions={backToSettings}
      />

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">{t("settings.embed.calendarEmbed.heading")}</h2>
        <p className="mt-1 text-sm text-muted">{t("settings.embed.calendarEmbed.description")}</p>
        <p className="mt-1 text-sm text-muted">
          {t("settings.embed.calendarEmbed.attributionNote")}
        </p>
        <div className="mt-4">
          <SnippetField
            label={t("settings.embed.calendarEmbed.fieldLabel")}
            rows={4}
            snippet={iframeSnippet}
            copyLabel={t("settings.embed.snippetField.copy")}
            copiedLabel={t("settings.embed.snippetField.copied")}
            failedLabel={t("settings.embed.snippetField.failed")}
          />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">{t("settings.embed.bookButton.heading")}</h2>
        <p className="mt-1 text-sm text-muted">{t("settings.embed.bookButton.description")}</p>
        <div className="mt-4">
          <SnippetField
            label={t("settings.embed.bookButton.fieldLabel")}
            rows={2}
            snippet={buttonSnippet}
            copyLabel={t("settings.embed.snippetField.copy")}
            copiedLabel={t("settings.embed.snippetField.copied")}
            failedLabel={t("settings.embed.snippetField.failed")}
          />
        </div>
      </section>

      <p className="mt-6 text-sm text-muted">
        {t.rich("settings.embed.footer", {
          link: (chunks) => (
            <a href={scheduleUrl} target="_blank" rel="noopener" className="text-primary underline">
              {chunks}
            </a>
          ),
        })}
      </p>
    </main>
  );
}
