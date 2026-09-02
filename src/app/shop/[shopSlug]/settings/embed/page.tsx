import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SectionCard } from "@/components/ui/card";
import { canPersonManageShopSettings } from "@/db/authz";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { escapeHtml } from "@/lib/html";
import { publicAppUrl } from "@/lib/notifications";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { publicSchedulePath } from "@/lib/public-routes";
import { requireShopSurface } from "@/lib/session";
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
export default async function EmbedSettingsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  // The snippet publishes the shop's schedule on the shop's own website — shop
  // configuration, so the same owner/manager gate as the settings page that
  // links here (src/lib/authz.ts — canManageShopSettings).
  //
  // The shop is built from the staff member's own session, never the route's
  // `shopSlug` param — a stale or mismatched URL segment must never generate a
  // snippet that labels one shop's name on another shop's calendar, and
  // `requireShopSurface` additionally 404s the two the moment they disagree.
  const { session, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });

  const t = staffTranslator(await requestLocale(shop.defaultLocale));

  const origin = publicAppUrl();
  const scheduleUrl = origin ? `${origin}${publicSchedulePath(shop.slug)}` : null;

  if (!scheduleUrl) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <ShopPageHeader
          eyebrow={t("settings.embed.eyebrow")}
          eyebrowHref={`/shop/${session.user.shopSlug}/settings`}
          title={t("settings.embed.title")}
        />
        <p className="rounded-lg bg-warning-tint px-4 py-3 text-sm font-medium text-warning-strong">
          {t("settings.embed.notConfigured", { email: SUPPORT_EMAIL })}
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
  // #576b72 is the light-mode `--muted` token value (src/app/globals.css) —
  // same reasoning as the button snippet below: this renders on the shop's
  // own site, outside DiveDay's CSS, so it inlines the real color rather than
  // referencing the custom property. Kept small and unobtrusive on purpose.
  // **1250px, measured, not guessed.** The widget shows the next four
  // departures and a link to the full schedule, which renders 989px tall at
  // this snippet's 720px max-width and 1217px on a phone — so this clears the
  // taller of the two and the frame never scrolls inside the shop's page.
  //
  // It was 900px against a full month of departures, which measured **2,734px**
  // — about a third of the schedule visible and the rest behind a scrollbar
  // nested in the shop's own site, worst on a phone where a visitor swiping
  // cannot tell which thing they are scrolling (issue #805). A frame cannot
  // guess this number while the content is a whole month, because the height
  // *is* however many departures a shop runs. Bounding the content is what
  // makes a fixed height honest.
  //
  // Sized for the narrow case deliberately: a desktop frame carries some slack
  // at the bottom, which is white space on the host page, and that is a far
  // smaller sin than a nested scroll on a phone.
  const iframeSnippet = `<iframe src="${embedUrl}" title="${shopNameAttr} — ${escapeHtml(bookButtonText)}" style="width:100%;max-width:720px;height:1250px;border:0;border-radius:12px" loading="lazy"></iframe>
<a href="${attributionUrl}" target="_blank" rel="noopener" style="display:block;margin-top:6px;font:12px/1.4 system-ui,sans-serif;color:#576b72;text-decoration:none">${escapeHtml(attributionLinkText)}</a>`;
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
        eyebrowHref={`/shop/${session.user.shopSlug}/settings`}
        title={t("settings.embed.title")}
        description={t("settings.embed.description")}
      />

      {/* Section rhythm belongs to the page, not to each section: one
          `space-y-10` here, and no `mt-*` on any card
          (docs/design/forms-and-controls.md). */}
      <div className="space-y-10">
        <SectionCard
          padding="lg"
          title={t("settings.embed.calendarEmbed.heading")}
          description={t("settings.embed.calendarEmbed.description")}
        >
          <p className="text-sm text-muted">{t("settings.embed.calendarEmbed.attributionNote")}</p>
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
        </SectionCard>

        <SectionCard
          padding="lg"
          title={t("settings.embed.bookButton.heading")}
          description={t("settings.embed.bookButton.description")}
        >
          <SnippetField
            label={t("settings.embed.bookButton.fieldLabel")}
            rows={2}
            snippet={buttonSnippet}
            copyLabel={t("settings.embed.snippetField.copy")}
            copiedLabel={t("settings.embed.snippetField.copied")}
            failedLabel={t("settings.embed.snippetField.failed")}
          />
        </SectionCard>
      </div>

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
