import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { escapeHtml } from "@/lib/html";
import { publicAppUrl } from "@/lib/notifications";
import { FOUNDER_EMAIL } from "@/lib/platform-mail";
import { requireStaffSession } from "@/lib/session";
import { SnippetField } from "./SnippetField";

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
  const scheduleUrl = origin ? `${origin}/shop/${shop.slug}/schedule` : null;

  if (!scheduleUrl) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <ShopPageHeader eyebrow={t("settings.embed.eyebrow")} title={t("settings.embed.title")} />
        <p className="rounded-lg bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
          {t("settings.embed.notConfigured", { email: FOUNDER_EMAIL })}
        </p>
      </main>
    );
  }

  const embedUrl = `${scheduleUrl}?embed=1`;
  const shopNameAttr = escapeHtml(shop.name);
  const bookButtonText = t("settings.embed.bookButton.buttonText");
  const iframeSnippet = `<iframe src="${embedUrl}" title="${shopNameAttr} — ${escapeHtml(bookButtonText)}" style="width:100%;max-width:720px;height:900px;border:0;border-radius:12px" loading="lazy"></iframe>`;
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
      />

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">{t("settings.embed.calendarEmbed.heading")}</h2>
        <p className="mt-1 text-sm text-muted">{t("settings.embed.calendarEmbed.description")}</p>
        <div className="mt-4">
          <SnippetField
            label={t("settings.embed.calendarEmbed.fieldLabel")}
            rows={3}
            snippet={iframeSnippet}
            copyLabel={t("settings.embed.snippetField.copy")}
            copiedLabel={t("settings.embed.snippetField.copied")}
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
