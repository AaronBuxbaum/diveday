import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FlashParams } from "@/components/FlashParams";
import { keptTypedScope } from "@/components/kept-typed-scope";
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
import { KeepBoatTypedOnRefusal } from "./_components/KeepBoatTypedOnRefusal";
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
                  <p>{t("boats.seats", { count: boat.capacity })}</p>
                  {boat.description ? <p>{boat.description}</p> : null}
                  <BoatPaperFacts boat={boat} t={t} todayLocal={todayLocal} locale={locale} />
                </div>
              }
            >
              <form action={updateBoatAction} className="space-y-4">
                <input type="hidden" name="boatId" value={boat.id} />
                {/* Captioned like the add form below (third review #36):
                        capacity is a safety number, and a bare "14" beside
                        the certificate's limit read as either. */}
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
                </FieldGrid>
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

        {/* **Every box says what it is for, above it.** An empty form has
              no values to read a box by, and its placeholders were its only
              labels: the 128px capacity box read "Capacity (se" and the
              description lost twenty characters of its own at 390 (K-145).
              Captions, the same ones the rows above carry. */}
        <DisclosureRow
          id={boatRowId("new")}
          className="print:hidden"
          heading={t("boats.createTitle")}
          open={Boolean(errorFor("new"))}
        >
          <FieldGrid as="form" columns={2} action={createBoatAction}>
            <KeepBoatTypedOnRefusal
              scope={keptTypedScope(shopSlug, session.user.personId)}
              restore={Boolean(errorFor("new"))}
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
