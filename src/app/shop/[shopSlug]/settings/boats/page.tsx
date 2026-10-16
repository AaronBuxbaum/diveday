import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import {
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { canPersonManageShopSettings } from "@/db/authz";
import { countDeparturesByBoat, listBoats } from "@/db/boats";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { AddPanel } from "../_components/AddPanel";
import { settingsPaneClass } from "../_components/settings-pane";
import { createBoatAction, deleteBoatAction, updateBoatAction } from "../boat-actions";
import { boatNoticeMessages } from "../sub-page-notices";
import { BoatPaperFacts, BoatPaperFields } from "./_components/BoatPaperFields";
import { boatCertificateError, boatRowId } from "./certificate-error";

// See the sibling settings sub-pages (ADR 20260804-instant-navigation).
export const instant = true;

/** Static metadata resolves before locale negotiation, so it stays English. */
export const metadata: Metadata = { title: "Boats — DiveDay" };

/**
 * **The shop's hulls, on a page of their own** — the second half of the
 * settings directory's rule (ADR 20260827-clearwater-surface-language,
 * decision 6): a row states an answer and opens the form that changes it, and
 * a row whose "form" is a list of boats with a Save and a Delete on each one
 * is not a row, it is a page wearing a disclosure. The hub lists it as a door
 * now; this is what the door opens.
 *
 * Nothing about the editor itself changed — the same three forms per hull, the
 * same confirm that names how many departures a hull has carried before it is
 * deleted, the same actions.
 *
 * A shore-and-pool shop has no hulls to name, so this route does not exist for
 * them: `hasBoatDiving` is the same condition that used to decide whether the
 * hub drew the row, and turning boat diving back on brings the fleet back
 * exactly as it was (nothing is deleted when the option goes off).
 */
export default async function BoatsSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    notice?: string;
    boat?: string;
    capacity?: string;
    passengers?: string;
    limit?: string;
    count?: string;
    dates?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const query = await searchParams;
  const { notice } = query;
  const { db, session, shop } = await requireShopSurface(shopSlug, {
    allow: canPersonManageShopSettings,
    refusal: { notice: "settings-not-authorized" },
  });
  if (!shop.hasBoatDiving) notFound();

  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // **How much history each hull carries**, so the confirm can say so before a
  // shop taps Delete: one grouped read beside the fleet, where it used to be
  // one count per hull after it.
  const [shopBoats, boatDepartures] = await Promise.all([
    listBoats(db, session.user.shopId),
    countDeparturesByBoat(db, session.user.shopId),
  ]);
  const banner = noticeFromParam(notice, boatNoticeMessages(t));
  // H-107's refusal is a field error on the row it is about, not a banner.
  const certificateError = boatCertificateError(t, query, locale);
  const errorFor = (boat: string) =>
    certificateError?.boat === boat
      ? { id: `${boatRowId(boat)}-error`, text: certificateError.text }
      : null;
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);

  return (
    <main className={settingsPaneClass()}>
      <FlashParams
        params={["notice", "boat", "capacity", "passengers", "limit", "count", "dates"]}
      />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("boats.heading")}
      />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}

      <SectionCard padding="lg">
        <div className="space-y-4">
          {shopBoats.length === 0 ? (
            <p className="text-sm text-muted italic">{t("boats.noBoats")}</p>
          ) : (
            <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
              {shopBoats.map((boat) => {
                const error = errorFor(boat.id);
                return (
                  <div
                    key={boat.id}
                    id={boatRowId(boat.id)}
                    className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 bg-surface scroll-mt-24"
                  >
                    <form
                      action={updateBoatAction}
                      className="flex flex-1 flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-3 w-full"
                    >
                      <input type="hidden" name="boatId" value={boat.id} />
                      {/* Captioned like the add form below (third review #36):
                        capacity is a safety number, and a bare "14" beside
                        the certificate's limit read as either. */}
                      <div className="grid w-full grid-cols-1 gap-3 sm:basis-full sm:grid-cols-2">
                        <Field label={t("boats.nameLabel")}>
                          <input
                            name="name"
                            type="text"
                            required
                            defaultValue={boat.name}
                            className={controlClass}
                          />
                        </Field>
                        <Field label={t("boats.capacityLabel")}>
                          <input
                            name="capacity"
                            type="number"
                            required
                            min={1}
                            defaultValue={boat.capacity}
                            aria-invalid={error ? true : undefined}
                            aria-describedby={error?.id}
                            className={`${controlClass} tabular-nums`}
                          />
                        </Field>
                        {/* A textarea, because the value is a sentence of up to
                          200 characters: a one-line box cut the seed's 72 at
                          its padding edge, mid-word (K-446). It grows with its
                          text and never shows fewer than two lines. */}
                        <Field label={t("boats.descriptionLabel")} className="sm:col-span-2">
                          <textarea
                            name="description"
                            rows={2}
                            maxLength={200}
                            defaultValue={boat.description ?? ""}
                            className={textareaClassFor(2)}
                          />
                        </Field>
                      </div>
                      <BoatPaperFields
                        boat={boat}
                        t={t}
                        invalid={Boolean(error)}
                        describedBy={error?.id}
                      />
                      {error ? (
                        <p
                          id={error.id}
                          role="alert"
                          className="w-full text-sm font-medium text-danger sm:basis-full"
                        >
                          {error.text}
                        </p>
                      ) : null}
                      <BoatPaperFacts boat={boat} t={t} todayLocal={todayLocal} />
                      {/* **Save and Delete on one line**, in the update form's
                        own action row rather than a form of their own apart.
                        The confirm posts to the delete through `formAction`,
                        taking the row's hidden `boatId` with it; Save comes
                        first, so Enter in a field saves and never deletes, and
                        names its own action so a delete in flight never reads
                        as a save. `flex-wrap` gives an armed confirm's message
                        a line of its own. Delete is `flush` (below), so the
                        row's gap hands back the 12px it gave up beside Save:
                        `gap-x-5`, the words 20px from Save's box as before. */}
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 w-full sm:w-auto justify-end">
                        <SubmitButton
                          pendingLabel={t("boats.submitting")}
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                          formAction={updateBoatAction}
                        >
                          {t("boats.submit")}
                        </SubmitButton>
                        {/* **The confirm says what the delete touches.** A hull
                          that has carried departures is history an insurer
                          asks about — the count is the fact a shop cannot get
                          from this row, and it is why this is a blocking
                          confirm rather than a bare button. A boat that never
                          sailed goes quietly, with no message to read. Nothing
                          is destroyed either way; the word is still "Delete"
                          and the shop is never told about a column (ADR
                          20260820-every-delete-is-soft). */}
                        {boatDepartures.get(boat.id) ? (
                          <InlineConfirm
                            formAction={deleteBoatAction}
                            triggerLabel={t("boats.deleteBoat")}
                            message={t("boats.deleteBoatDepartures", {
                              count: boatDepartures.get(boat.id) ?? 0,
                            })}
                            cancelLabel={t("boats.deleteBoatCancel")}
                            confirmLabel={t("boats.deleteBoatConfirm")}
                            pendingLabel={t("boats.deleteBoatPending")}
                            // `flush` puts "Delete boat" on the row's edge where
                            // it ends the row (a phone); the row's `p-3` in an
                            // `overflow-hidden` list is a pixel short of an outset
                            // ring past the flush fill, so it is inside. The armed
                            // block's confirm is not on that edge.
                            triggerClassName={buttonClass({
                              variant: "danger-ghost",
                              size: "sm",
                              flush: true,
                              className: "focus-visible:focus-ring-inset",
                            })}
                            confirmClassName={buttonClass({ variant: "danger-ghost", size: "sm" })}
                          />
                        ) : (
                          <InlineConfirm
                            formAction={deleteBoatAction}
                            triggerLabel={t("boats.deleteBoat")}
                            confirmLabel={t("boats.deleteBoatConfirm")}
                            pendingLabel={t("boats.deleteBoatPending")}
                            triggerClassName={buttonClass({
                              variant: "danger-ghost",
                              size: "sm",
                              flush: true,
                              className: "focus-visible:focus-ring-inset",
                            })}
                          />
                        )}
                      </div>
                    </form>
                  </div>
                );
              })}
            </div>
          )}

          {/* **Every box says what it is for, above it.** An empty form has
              no values to read a box by, and its placeholders were its only
              labels: the 128px capacity box read "Capacity (se" and the
              description lost twenty characters of its own at 390 (K-145).
              Captions, the same ones the rows above carry. */}
          <AddPanel title={t("boats.createTitle")}>
            <FieldGrid
              as="form"
              columns={2}
              action={createBoatAction}
              id={boatRowId("new")}
              className="scroll-mt-24"
            >
              <Field label={t("boats.nameLabel")}>
                <input name="name" type="text" required className={controlClass} />
              </Field>
              <Field label={t("boats.capacityLabel")} error={errorFor("new")?.text}>
                <input
                  name="capacity"
                  type="number"
                  required
                  min={1}
                  className={`${controlClass} tabular-nums`}
                />
              </Field>
              <Field label={t("boats.descriptionLabel")} className="sm:col-span-2">
                <textarea
                  name="description"
                  rows={2}
                  maxLength={200}
                  className={textareaClassFor(2)}
                />
              </Field>
              <BoatPaperFields t={t} className="sm:col-span-2" invalid={Boolean(errorFor("new"))} />
              <FieldActions>
                <SubmitButton
                  pendingLabel={t("boats.submitting")}
                  className={buttonClass({ variant: "secondary", size: "sm" })}
                >
                  {t("boats.addBoat")}
                </SubmitButton>
              </FieldActions>
            </FieldGrid>
          </AddPanel>
        </div>
      </SectionCard>
    </main>
  );
}
