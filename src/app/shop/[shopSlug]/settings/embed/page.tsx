import type { Metadata } from "next";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { canPersonManageShopSettings } from "@/db/authz";
import { listActiveCourses } from "@/db/courses";
import { listEmbedSets } from "@/db/embed-sets";
import { pagedUpcomingTripsWithCounts } from "@/db/trips";
import { localeEndonym } from "@/i18n/language-labels";
import { requestLocale } from "@/i18n/request";
import { DIVER_LOCALES } from "@/i18n/settings";
import { staffTranslator } from "@/i18n/staff-messages";
import { brandDisplayFontFamily, DIVEDAY_BRAND_COLOR, isBrandDisplayFontCode } from "@/lib/brand";
import { nowDate } from "@/lib/clock";
import { EMBED_SET_MAX } from "@/lib/embed-sets";
import { EMBED_KINDS, type EmbedKind, PLATFORMS, type Platform } from "@/lib/embed-snippets";
import { formatDayParts, formatTime } from "@/lib/format";
import { publicAppUrl } from "@/lib/notifications";
import { SUPPORT_EMAIL } from "@/lib/platform-mail";
import { publicSchedulePath } from "@/lib/public-routes";
import { requireShopSurface } from "@/lib/session";
import { type FormNotice, noticeForForm, noticeFromParam } from "@/lib/staff-notices";
import { EmbedGenerator, type EmbedGeneratorCopy } from "./EmbedGenerator";
import { EmbedSets } from "./EmbedSets";
import { EMBED_SETS_FORM } from "./forms";

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
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string; form?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice: noticeCode } = await searchParams;
  const { session, shop, db } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const setsNoticeText = (key: "saved" | "deleted" | "invalid" | "missing") =>
    t(`settings.embed.sets.notice.${key}`);
  const setsTooManyText = t("settings.embed.sets.notice.tooMany", { max: EMBED_SET_MAX });
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
  const { trips } = await pagedUpcomingTripsWithCounts(db, shop.id, {
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
  // The courses widget can frame one course (issue #1284). Active only, and in
  // the roster's progression order rather than alphabetically — the same order
  // `listActiveCourses` gives every other surface, so a shop picking "Open
  // Water" finds it where it always is.
  const courseChoices = (await listActiveCourses(db, shop.id)).map((course) => ({
    id: course.slug,
    label: course.title,
  }));
  // The shop's own named lists — the fourth of the ADR's "what it shows"
  // answers (issue #1284). Both the generator's select and the editor below it
  // read the same rows, so a list a shop just named is offered immediately.
  const sets = await listEmbedSets(db, shop.id);
  // Every code this page can answer with belongs to one form — the lists
  // editor — so it is routed there rather than to a banner under the `<h1>`,
  // which on a page this tall is nowhere near what the reader just submitted.
  const setsNotice = noticeFromParam(noticeCode, {
    "embed-set-saved": { form: EMBED_SETS_FORM, tone: "success", text: setsNoticeText("saved") },
    "embed-set-deleted": {
      form: EMBED_SETS_FORM,
      tone: "success",
      text: setsNoticeText("deleted"),
    },
    "embed-set-invalid": { form: EMBED_SETS_FORM, tone: "danger", text: setsNoticeText("invalid") },
    "embed-set-too-many": { form: EMBED_SETS_FORM, tone: "danger", text: setsTooManyText },
    "embed-set-missing": { form: EMBED_SETS_FORM, tone: "danger", text: setsNoticeText("missing") },
  } satisfies Record<string, FormNotice>);
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
    showRequired: t("settings.embed.showRequired"),
    kinds,
    kindHints,
    shows: t("settings.embed.shows"),
    showEverything: t("settings.embed.showEverything"),
    showDeparture: t("settings.embed.showDeparture"),
    showAllCourses: t("settings.embed.showAllCourses"),
    setsGroup: t("settings.embed.sets.group"),
    look: t("settings.embed.look"),
    lookSite: t("settings.embed.lookSite"),
    lookLight: t("settings.embed.lookLight"),
    lookNote: t("settings.embed.lookNote"),
    language: t("settings.embed.language"),
    languageAuto: t("settings.embed.languageAuto"),
    languages: Object.fromEntries(DIVER_LOCALES.map((l) => [l, localeEndonym(l)])),
    preview: t("settings.embed.preview"),
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
        courses={courseChoices}
        sets={sets.map((set) => ({ id: set.id, label: set.name, kind: set.kind }))}
        locales={DIVER_LOCALES}
        previewHost={{
          brand: shop.brandColor ?? DIVEDAY_BRAND_COLOR,
          font: isBrandDisplayFontCode(shop.brandDisplayFont)
            ? brandDisplayFontFamily(shop.brandDisplayFont)
            : null,
        }}
        copy={copy}
      />
      {/* Section rhythm belongs to the page: one `space-y-10` above, and no
          `mt-*` on the card (docs/design/forms-and-controls.md). The generator
          already renders its own `space-y-10` stack, so this joins it. */}
      <div className="mt-10">
        <EmbedSets
          shopSlug={shop.slug}
          sets={sets}
          trips={tripChoices}
          courses={courseChoices}
          notice={noticeForForm(setsNotice, EMBED_SETS_FORM)}
          copy={{
            title: t("settings.embed.sets.title"),
            nameLabel: t("settings.embed.sets.nameLabel"),
            namePlaceholder: {
              trip: t("settings.embed.sets.namePlaceholder.trip"),
              course: t("settings.embed.sets.namePlaceholder.course"),
            },
            membersLabel: t("settings.embed.sets.membersLabel"),
            add: t("settings.embed.sets.add"),
            addNamed: (kind) => t("settings.embed.sets.addNamed", { kind }),
            save: t("settings.embed.sets.save"),
            saving: t("settings.embed.sets.saving"),
            deleteNamed: (name) => t("settings.embed.sets.deleteNamed", { name }),
            deleteConfirm: (name) => t("settings.embed.sets.deleteConfirm", { name }),
            kinds: {
              trip: t("settings.embed.sets.kinds.trip"),
              course: t("settings.embed.sets.kinds.course"),
            },
          }}
        />
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
      {/* The board's "Coming from FareHarbor" line: each widget FareHarbor
          sells has its equivalent here, and the guide is where the mapping
          is written out. */}
      <p className="mt-2 text-sm text-muted">
        {t.rich("settings.embed.fromFareharbor", {
          link: (chunks) => (
            <a href="/switching/fareharbor" className="text-primary underline">
              {chunks}
            </a>
          ),
        })}
      </p>
    </main>
  );
}
