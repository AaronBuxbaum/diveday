import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { canPersonManageShopSettings } from "@/db/authz";
import { getDb } from "@/db/client";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { localeEndonym } from "@/i18n/language-labels";
import { requestLocale } from "@/i18n/request";
import { DIVER_LOCALES } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { nowDate } from "@/lib/clock";
import { EMBED_KINDS, type EmbedKind } from "@/lib/embed-snippets";
import { formatDayParts, formatTime } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { publicSchedulePath } from "@/lib/public-routes";
import { requireShopSurface } from "@/lib/session";
import {
  EmbedGenerator,
  type EmbedGeneratorCopy,
  PLATFORMS,
  type Platform,
} from "./EmbedGenerator";

export const instant = true;

export const metadata: Metadata = { title: "Website embed — DiveDay" };

/**
 * Settings → Website embed: the embed catalogue's generator (Harbor — ADR
 * 20260901-diveday-reimagined, decision 2). This page reads what the generator
 * needs — the origin, the departures a shop can pin, the languages DiveDay
 * speaks — and hands it every word; the composing happens in the browser so a
 * choice updates the snippet and the preview with no round trip.
 */
export default async function EmbedSettingsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  const { shopSlug } = await params;
  const { session, shop, db } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const origin = publicAppUrl();
  const header = (
    <ShopPageHeader
      eyebrow={t("settings.embed.eyebrow")}
      eyebrowHref={`/shop/${session.user.shopSlug}/settings`}
      title={t("settings.embed.title")}
      description={origin ? t("settings.embed.description") : undefined}
    />
  );
  if (!origin) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {header}
        <p className="rounded-lg bg-warning-tint px-4 py-3 text-sm font-medium text-warning-strong">
          {t("settings.embed.notConfigured", { email: SUPPORT_EMAIL })}
        </p>
      </main>
    );
  }
  void db;
  const { trips } = await pagedUpcomingTripsWithCounts(await getDb(), shop.id, {
    now: nowDate(),
    limit: 30,
    publicOnly: true,
  });
  const tripChoices = trips.map((trip) => {
    const parts = formatDayParts(trip.startsAt, locale, shop.timezone);
    return {
      id: trip.id,
      label: `${parts.weekday} ${parts.day} ${parts.month} · ${formatTime(trip.startsAt, locale, shop.timezone)} — ${trip.title}`,
    };
  });
  const kinds = Object.fromEntries(
    EMBED_KINDS.map((kind) => [kind, t(`settings.embed.kinds.${kind}.name`)]),
  ) as Record<EmbedKind, string>;
  const kindHints = Object.fromEntries(
    EMBED_KINDS.map((kind) => [kind, t(`settings.embed.kinds.${kind}.hint`)]),
  ) as Record<EmbedKind, string>;
  const platforms = Object.fromEntries(
    PLATFORMS.map((p) => [p, t(`settings.embed.platforms.${p}.name`)]),
  ) as Record<Platform, string>;
  const platformNotes = Object.fromEntries(
    PLATFORMS.map((p) => [p, t(`settings.embed.platforms.${p}.note`)]),
  ) as Record<Platform, string>;
  const copy: EmbedGeneratorCopy = {
    what: t("settings.embed.what"),
    kinds,
    kindHints,
    shows: t("settings.embed.shows"),
    showEverything: t("settings.embed.showEverything"),
    showDeparture: t("settings.embed.showDeparture"),
    look: t("settings.embed.look"),
    lookSite: t("settings.embed.lookSite"),
    lookLight: t("settings.embed.lookLight"),
    lookNote: t("settings.embed.lookNote"),
    language: t("settings.embed.language"),
    languageAuto: t("settings.embed.languageAuto"),
    languages: Object.fromEntries(DIVER_LOCALES.map((l) => [l, localeEndonym(l)])),
    preview: t("settings.embed.preview"),
    previewNote: t("settings.embed.previewNote"),
    platform: t("settings.embed.platform"),
    platforms,
    platformNotes,
    snippet: t("settings.embed.snippet"),
    code: t("settings.embed.code"),
    buttonText: t("settings.embed.bookButton.buttonText"),
    partnerName: t("settings.embed.partnerName"),
    partnerPlaceholder: t("settings.embed.partnerPlaceholder"),
    partnerLink: t("settings.embed.partnerLink"),
    partnerLinkField: t("settings.embed.partnerLinkField"),
    qrAlt: t("settings.embed.qrAlt"),
    qrDownload: t("settings.embed.qrDownload"),
    copy: t("settings.embed.snippetField.copy"),
    copied: t("settings.embed.snippetField.copied"),
    copyFailed: t("settings.embed.snippetField.failed"),
  };
  const scheduleUrl = `${origin}${publicSchedulePath(shop.slug)}`;
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      {header}
      <EmbedGenerator
        origin={origin}
        shopSlug={shop.slug}
        trips={tripChoices}
        locales={DIVER_LOCALES}
        copy={copy}
      />
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
