import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { KeepTypedOnRefusal } from "@/components/KeepTypedOnRefusal";
import { keptTypedScope } from "@/components/kept-typed-scope";
import { RemovablePhoto, removablePhotoGridClass } from "@/components/RemovablePhoto";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { DisclosureRow, DisclosureRowList } from "@/components/ui/disclosure";
import {
  controlClass,
  Field,
  FieldActions,
  FieldGrid,
  textareaClassFor,
} from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { canPersonManageBoats } from "@/db/authz";
import { countDeparturesByBoat, listBoats } from "@/db/boats";
import { requestLocale } from "@/i18n/request";
import { staffTranslator } from "@/i18n/staff-messages";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { requireShopSurface } from "@/lib/session";
import { noticeFromParam } from "@/lib/staff-notices";
import { registerPaneClass } from "../_components/register-pane";
import { BoatPaperFacts, BoatPaperFields } from "./_components/BoatPaperFields";
import { createBoatAction, deleteBoatAction, updateBoatAction } from "./actions";
import { boatCertificateError, boatRowId } from "./certificate-error";
import { boatNoticeMessages, boatValidationError } from "./notices";

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
 * The register states each hull's name, seats and paper warnings before its
 * editor opens. The same actions and history-aware delete remain in that editor.
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
    allow: canPersonManageBoats,
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
  // Refusals stay beside the editor they name, including Add. An unscoped
  // or unknown-row refusal still has a banner, so a forged ID cannot silence it.
  const certificateError = boatCertificateError(t, query, locale);
  const validationError = boatValidationError(t, query);
  const knownValidationError =
    validationError &&
    (validationError.boat === "new" || shopBoats.some((boat) => boat.id === validationError.boat))
      ? validationError
      : null;
  const editorError = certificateError ?? knownValidationError;
  const banner = knownValidationError ? undefined : noticeFromParam(notice, boatNoticeMessages(t));
  const errorFor = (boat: string) =>
    editorError?.boat === boat ? { id: `${boatRowId(boat)}-error`, text: editorError.text } : null;
  const certificateInvalid = (boat: string) => certificateError?.boat === boat;
  const todayLocal = calendarDateInTimezone(nowDate(), shop.timezone);

  return (
    <main className={registerPaneClass()}>
      <FlashParams
        params={["notice", "boat", "capacity", "passengers", "limit", "count", "dates"]}
      />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={t("boats.heading")}
      />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}

      <DisclosureRowList>
        {shopBoats.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted sm:px-5">{t("boats.noBoats")}</p>
        ) : null}
        {shopBoats.map((boat) => {
          const error = errorFor(boat.id);
          return (
            <DisclosureRow
              key={boat.id}
              id={boatRowId(boat.id)}
              heading={boat.name}
              open={Boolean(error)}
              value={
                <div className="space-y-1">
                  <p>{t("boats.peopleAboard", { count: boat.capacity })}</p>
                  {boat.description ? <p>{boat.description}</p> : null}
                  <BoatPaperFacts boat={boat} t={t} todayLocal={todayLocal} locale={locale} />
                </div>
              }
            >
              <form action={updateBoatAction} className="space-y-4">
                <input type="hidden" name="boatId" value={boat.id} />
                {/* Capacity is a safety number; label it so it cannot be confused with the
                    certificate's limit. */}
                <FieldGrid columns={2}>
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
                      aria-invalid={certificateInvalid(boat.id) || undefined}
                      aria-describedby={certificateInvalid(boat.id) ? error?.id : undefined}
                      className={`${controlClass} tabular-nums`}
                    />
                  </Field>
                  {/* Descriptions are sentences up to 200 characters; the textarea avoids the
                      mid-word clipping noted in K-446, grows with its text, and shows two lines. */}
                  <Field label={t("boats.descriptionLabel")} className="sm:col-span-2">
                    <textarea
                      name="description"
                      rows={2}
                      maxLength={200}
                      defaultValue={boat.description ?? ""}
                      className={textareaClassFor(2)}
                    />
                  </Field>
                </FieldGrid>
                <div className="space-y-3">
                  {boat.photoUrl ? (
                    <div className={removablePhotoGridClass}>
                      <RemovablePhoto
                        url={boat.photoUrl}
                        name="removeBoatPhoto"
                        label={t("boats.removePhoto")}
                      />
                    </div>
                  ) : null}
                  <Field label={t("boats.photoLabel")}>
                    <input
                      type="file"
                      name="boatPhoto"
                      accept="image/jpeg,image/png,image/webp"
                      className={controlClass}
                    />
                  </Field>
                </div>
                <BoatPaperFields
                  boat={boat}
                  t={t}
                  invalid={certificateInvalid(boat.id)}
                  radioInvalid={Boolean(error) && notice === "boat-radio-invalid"}
                  channelInvalid={Boolean(error) && notice === "boat-channel-distress"}
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
                {/* Keep Save and Delete in the update form's action row. Delete's `formAction`
                    submits the hidden boat ID; Save comes first so Enter submits the update.
                    Wrapping gives an armed confirmation message its own line. */}
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
            </DisclosureRow>
          );
        })}

        {/* Give each empty-form field a visible caption; placeholders alone do not identify the
            fields, especially when narrow boxes truncate their text (K-145). */}
        <DisclosureRow
          id={boatRowId("new")}
          className="print:hidden"
          heading={t("boats.createTitle")}
          open={Boolean(errorFor("new"))}
        >
          <FieldGrid as="form" columns={2} action={createBoatAction}>
            <KeepTypedOnRefusal
              form="boats-add"
              scope={keptTypedScope(shopSlug, session.user.personId)}
              restore={Boolean(errorFor("new"))}
              policy="boat-paper-dates"
            />
            <Field label={t("boats.nameLabel")}>
              <input name="name" type="text" required className={controlClass} />
            </Field>
            <Field label={t("boats.capacityLabel")}>
              <input
                name="capacity"
                type="number"
                required
                min={1}
                aria-invalid={certificateInvalid("new") || undefined}
                aria-describedby={certificateInvalid("new") ? errorFor("new")?.id : undefined}
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
            <BoatPaperFields
              t={t}
              className="sm:col-span-2"
              invalid={certificateInvalid("new")}
              radioInvalid={Boolean(errorFor("new")) && notice === "boat-radio-invalid"}
              channelInvalid={Boolean(errorFor("new")) && notice === "boat-channel-distress"}
              describedBy={errorFor("new")?.id}
            />
            {errorFor("new") ? (
              <p
                id={errorFor("new")?.id}
                role="alert"
                className="text-sm font-medium text-danger sm:col-span-2"
              >
                {errorFor("new")?.text}
              </p>
            ) : null}
            <FieldActions>
              <SubmitButton pendingLabel={t("boats.submitting")} className={buttonClass()}>
                {t("boats.addBoat")}
              </SubmitButton>
            </FieldActions>
          </FieldGrid>
        </DisclosureRow>
      </DisclosureRowList>
    </main>
  );
}
