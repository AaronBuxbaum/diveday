import type { Metadata } from "next";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, DateField, Field, FieldActions, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { canPersonManageShopSettings } from "@/db/authz";
import { listSeasonEvents } from "@/db/season-events";
import { listTripLenses } from "@/db/trip-lenses";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import {
  isSeasonEventLive,
  SEASON_EVENT_NAME_MAX,
  SEASON_EVENT_NOTE_MAX,
} from "@/lib/season-events";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import {
  createSeasonEventAction,
  deleteSeasonEventAction,
  updateSeasonEventAction,
} from "../actions";
import { seasonEventNoticeMessages } from "../sub-page-notices";

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Seasons and events — DiveDay" };

/**
 * **The reef's calendar** (issue #1485): the shop types mini-season, its two
 * days and what it wants divers to know, and the storefront shows exactly that
 * while the week is on.
 *
 * This is the row that made the case for the whole extraction. On the hub it
 * was one `⌄`, and behind it sat three full season forms — name, kind, first
 * day, last day, a textarea, a Save and a Delete each — plus a fourth form to
 * add one: six Save/Delete buttons inside a single row of a directory. A row
 * states an answer and opens the form that changes it; a row that opens onto a
 * list of forms is a page (ADR 20260827-clearwater-surface-language, decision
 * 6).
 *
 * Ungated like "Kinds of day" beside it — a shore-diving shop still has a
 * mini-season — and it reads the shop's own words for its kinds of day, because
 * a season usually names one.
 */
export default async function SeasonsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const { shopSlug } = await params;
  const { notice } = await searchParams;
  const { db, session, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  const [shopSeasons, shopLenses] = await Promise.all([
    listSeasonEvents(db, session.user.shopId),
    listTripLenses(db, session.user.shopId),
  ]);
  /**
   * Today at the shop, for the one badge on this page: which season is running
   * right now. The shop's own calendar day, never the server's — a Key Largo
   * mini-season closes at midnight in Key Largo (`src/lib/season-events.ts`).
   */
  const shopCalendarToday = calendarDateInTimezone(nowDate(), shop.timezone);
  const banner = noticeFromParam(notice, seasonEventNoticeMessages(t));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("seasonEvents.heading")}
      />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}

      <SectionCard padding="lg">
        <div className="space-y-4">
          {shopSeasons.length === 0 ? (
            <p className="text-sm text-muted italic">{t("seasonEvents.none")}</p>
          ) : (
            <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
              {shopSeasons.map((season) => (
                <div key={season.id} className="space-y-3 p-3 bg-surface">
                  {/* The one badge on this page, and it marks the exceptional
                      state (principle 9): most of a shop's calendar is months
                      away, and the one week that is actually on the storefront
                      right now is the one worth finding at a glance. */}
                  {isSeasonEventLive(season, shopCalendarToday) ? (
                    <Badge tone="success">{t("seasonEvents.live")}</Badge>
                  ) : null}
                  <FieldGrid as="form" columns={2} action={updateSeasonEventAction}>
                    <input type="hidden" name="eventId" value={season.id} />
                    <Field label={t("seasonEvents.nameLabel")}>
                      <input
                        name="name"
                        type="text"
                        required
                        maxLength={SEASON_EVENT_NAME_MAX}
                        defaultValue={season.name}
                        className={controlClass}
                      />
                    </Field>
                    <Field label={t("seasonEvents.lensLabel")}>
                      <select
                        name="lensId"
                        defaultValue={season.lensId ?? ""}
                        className={controlClass}
                      >
                        <option value="">{t("seasonEvents.lensNone")}</option>
                        {shopLenses.map((lens) => (
                          <option key={lens.id} value={lens.id}>
                            {lens.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label={t("seasonEvents.startLabel")}>
                      <DateField name="startsOn" required defaultValue={season.startsOn} />
                    </Field>
                    <Field label={t("seasonEvents.endLabel")}>
                      <DateField name="endsOn" required defaultValue={season.endsOn} />
                    </Field>
                    <Field label={t("seasonEvents.noteLabel")} className="sm:col-span-2">
                      <textarea
                        name="note"
                        rows={2}
                        maxLength={SEASON_EVENT_NOTE_MAX}
                        defaultValue={season.note ?? ""}
                        className={controlClass}
                      />
                    </Field>
                    <FieldActions>
                      <SubmitButton
                        pendingLabel={t("seasonEvents.submitting")}
                        className={buttonClass({ variant: "secondary", size: "sm" })}
                      >
                        {t("seasonEvents.submit")}
                      </SubmitButton>
                    </FieldActions>
                  </FieldGrid>
                  {/* Its own form beside the edit, never inside it:
                      `InlineConfirm` submits the form it sits in, and forms
                      cannot nest. */}
                  <form action={deleteSeasonEventAction}>
                    <input type="hidden" name="eventId" value={season.id} />
                    <InlineConfirm
                      triggerLabel={t("seasonEvents.delete")}
                      confirmLabel={t("seasonEvents.deleteConfirm")}
                      pendingLabel={t("seasonEvents.deletePending")}
                      // `flush` puts "Delete" on the fields' edge. The row's
                      // `p-3` leaves 12px to the list's `overflow-hidden`, a
                      // pixel short of an outset ring past the flush fill, so
                      // the ring is drawn inside.
                      triggerClassName={buttonClass({
                        variant: "danger-ghost",
                        size: "sm",
                        flush: true,
                        className: "focus-visible:focus-ring-inset",
                      })}
                    />
                  </form>
                </div>
              ))}
            </div>
          )}

          <div className="border border-dashed border-border rounded-lg p-4 bg-surface-sunken">
            <h2 className="text-sm font-medium mb-3">{t("seasonEvents.createTitle")}</h2>
            <FieldGrid as="form" columns={2} action={createSeasonEventAction}>
              <Field label={t("seasonEvents.nameLabel")}>
                <input
                  name="name"
                  type="text"
                  required
                  maxLength={SEASON_EVENT_NAME_MAX}
                  className={controlClass}
                />
              </Field>
              <Field label={t("seasonEvents.lensLabel")}>
                <select name="lensId" defaultValue="" className={controlClass}>
                  <option value="">{t("seasonEvents.lensNone")}</option>
                  {shopLenses.map((lens) => (
                    <option key={lens.id} value={lens.id}>
                      {lens.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("seasonEvents.startLabel")}>
                <DateField name="startsOn" required />
              </Field>
              <Field label={t("seasonEvents.endLabel")}>
                <DateField name="endsOn" required />
              </Field>
              {/* The one line that earns its place here, for the same reason
                  the vocabulary's hint does: it names the consequence a shop
                  cannot see from this form, which is that these words go out to
                  divers. */}
              <Field
                label={t("seasonEvents.noteLabel")}
                description={t("seasonEvents.hint")}
                className="sm:col-span-2"
              >
                <textarea
                  name="note"
                  rows={2}
                  maxLength={SEASON_EVENT_NOTE_MAX}
                  className={controlClass}
                />
              </Field>
              <FieldActions>
                <SubmitButton
                  pendingLabel={t("seasonEvents.adding")}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {t("seasonEvents.add")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          </div>
        </div>
      </SectionCard>
    </main>
  );
}
