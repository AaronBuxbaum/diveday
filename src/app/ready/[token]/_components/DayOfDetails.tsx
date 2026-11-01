import { ShopContactLinks } from "@/components/ShopContactLinks";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import {
  ChoiceFieldset,
  ChoiceRow,
  controlClass,
  Field,
  textareaClassFor,
} from "@/components/ui/form";
import type { ReadyPageData } from "@/db/ready";
import { DIVER_DIVE_INTENT_KEYS, DIVER_RE_ENTRY_KEYS } from "@/i18n/dive-intent-labels";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_DIVE_RECENCY_KEYS } from "@/i18n/readiness-labels";
import { DIVE_INTENTS } from "@/lib/dive-intent";
import { DIVE_RECENCY_BANDS } from "@/lib/dive-recency";
import { DIETARY_NOTE_MAX } from "@/lib/lunch-aboard";
import { isDiver } from "@/lib/participant-types";
import { reEntryOffersFor } from "@/lib/re-entry";
import { saveDayOfDetailsFromReady } from "../day-of-actions";

/** One radio, worded on its right. */
function RadioRow({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <ChoiceRow
      type="radio"
      name={name}
      value={value}
      defaultChecked={defaultChecked}
      className="text-base"
    >
      {label}
    </ChoiceRow>
  );
}

/**
 * **Day-of details** — the last step of the thread's spine, and the one that
 * absorbed four separate rows.
 *
 * Before this it was separate rows: "When did you last dive?", the diver's own
 * note to the crew and the hotel-pickup question, each a row of its own on a
 * checklist, the optional ones permanently marked "Optional" because most
 * divers have nothing to say to them. Rows that could never settle are reasons
 * the figure over the list could never fill, which is the defect ADR
 * 20260827-the-divers-thread, decision 3 set out to end.
 *
 * So the step **counts, and settles on the recency question** — the one thing
 * genuinely asked of everybody. The others ride inside it and gate nothing:
 * answering none of them still finishes the step.
 *
 * **One form, one Save** (third UX review, item 24). It was six forms and six
 * Save buttons, and a diver who answered all six and tapped the last Save kept
 * one answer. `saveDayOfDetailsFromReady` writes only the answers that changed,
 * each to its own column, so answering one still cannot blank another.
 */
export function DayOfDetails({
  token,
  data,
  saved,
  t,
}: {
  token: string;
  data: ReadyPageData;
  /** The step was just saved (`?saved=day-of`). */
  saved: boolean;
  t: DiverTranslator;
}) {
  const diving = isDiver(data.participantType);
  const meetingInfo = [
    data.trip.meetingPointLabel,
    data.trip.meetingPointAddress,
    data.trip.arrivalLandmark,
    data.trip.arrivalParkingNote,
    data.trip.arrivalTransitNote,
    data.trip.arrivalLookFor,
    data.trip.arrivalFirstInteraction,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const shopReachable = Boolean(data.shop.contactPhone || data.shop.contactEmail);
  return (
    <form action={saveDayOfDetailsFromReady.bind(null, token)}>
      {/* The gear step's own "Saved.", for the same reason: the redirect
          carries no hash, so the page-level notice is what a diver reads on
          arrival and this is what they read in the step itself. */}
      {saved ? (
        <p
          role="status"
          className="mb-3 rounded-lg bg-success-tint px-3 py-2 text-sm font-medium text-success-strong"
        >
          {t("rental.savedNote")}
        </p>
      ) : null}
      <div className="divide-y divide-border">
        {/* A seat that is not diving is not asked when it last dived, what the
            dive is for, or for a refresher (ADR 20261007-participant-types). */}
        {diving ? (
          <>
            {/* **The question nobody was asking.** A rung is what the shop
                gates on; currency is what actually catches people, and an
                honest "Advanced Open Water" from 1998 with no dive since 2013
                clears every check in this product (ADR
                20260821-currency-is-what-catches-people). It gates nothing.
                "Choose" posts nothing to write, never a blank. */}
            <div className="pb-5">
              <Field label={t("ready.lastDivedHeading")} htmlFor="last-dived">
                <select
                  id="last-dived"
                  name="lastDivedBand"
                  defaultValue={data.lastDivedBand ?? ""}
                  className={controlClass}
                >
                  <option value="">{t("ready.lastDivedChoose")}</option>
                  {DIVE_RECENCY_BANDS.map((band) => (
                    <option key={band} value={band}>
                      {t(DIVER_DIVE_RECENCY_KEYS[band])}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {/* A diver's post-booking link can be used to supply dive intent.
                Keep the audience explanation associated with the select below. */}
            <div className="flex flex-col gap-3 py-5">
              <Field label={t("ready.intentHeading")} htmlFor="dive-intent">
                <select
                  id="dive-intent"
                  name="diveIntent"
                  defaultValue={data.diveIntent ?? ""}
                  aria-describedby="dive-intent-audience"
                  className={controlClass}
                >
                  <option value="">{t("ready.intentChoose")}</option>
                  {DIVE_INTENTS.map((intent) => (
                    <option key={intent} value={intent}>
                      {t(DIVER_DIVE_INTENT_KEYS[intent])}
                    </option>
                  ))}
                </select>
              </Field>
              <p id="dive-intent-audience" className="text-sm text-muted">
                {t("booking.intent.audience")}
              </p>
            </div>
            {/* **D18's three offers, where the answer that opens them lives**
                (ADR 20260904-reef-all-the-way-down, D18). Both gates, the saved
                intent and the offer window, are `getReadyPageData`'s, and the
                action re-derives them, so this renders exactly what the save
                will accept. */}
            {data.reEntryOffersOpen ? (
              <div className="flex flex-col gap-3 py-5">
                <ChoiceFieldset
                  legend={t("booking.reEntry.legend")}
                  bodyClassName="flex flex-col gap-1"
                >
                  {reEntryOffersFor(data.refresherCourseOffered).map((ask) => (
                    <ChoiceRow
                      key={ask}
                      type="radio"
                      name="reEntryAsk"
                      value={ask}
                      defaultChecked={data.reEntryAsk === ask}
                      className="text-sm"
                    >
                      {t(DIVER_RE_ENTRY_KEYS[ask])}
                    </ChoiceRow>
                  ))}
                </ChoiceFieldset>
                {/* The one sentence here that has to exist: an offer of help on
                    a readiness checklist reads as a condition unless it says it
                    is not one. */}
                <p className="text-sm text-muted">{t("booking.reEntry.noGate")}</p>
              </div>
            ) : null}
          </>
        ) : null}
        {/* **The diver's own words.** Written to the note column alone, so it
            cannot blank sizes set last week (issue 627). */}
        <div className="py-5">
          <Field label={t("rental.anythingElse")} htmlFor="crew-note">
            <textarea
              id="crew-note"
              name="note"
              rows={2}
              maxLength={300}
              defaultValue={data.rentalFit?.note ?? ""}
              className={textareaClassFor(2)}
            />
          </Field>
        </div>
        {/* The question asks about the *service*, not the address. "Where are
            you staying?" on a list of things a diver owes their shop reads as a
            records question. The field under it keeps the address label.
            Asked only at a shop that says it runs pickups (fourth UX review,
            item 8): most do not, and asking was a promise never made. */}
        {data.offersHotelPickup ? (
          <div className="py-5">
            <h3 className="text-base font-semibold">{t("ready.hotelPickupLabel")}</h3>
            <Field label={t("ready.hotelPickupFieldLabel")} htmlFor="hotel-pickup" className="mt-3">
              <input
                id="hotel-pickup"
                type="text"
                name="hotelPickupLocation"
                maxLength={300}
                placeholder={t("ready.hotelPickupPlaceholder")}
                defaultValue={data.hotelPickupLocation ?? ""}
                className={controlClass}
              />
            </Field>
          </div>
        ) : null}
        {/* **Lunch aboard** (fifth-loop ideas, item 56): asked only on a
            departure that serves it. For the galley; a severe allergy is told
            to the shop directly too, and the hint says so. */}
        {data.lunchAboard ? (
          <div className="py-5">
            <Field
              label={t("ready.dietaryLabel")}
              description={t("ready.dietaryHint")}
              htmlFor="dietary-note"
            >
              <input
                id="dietary-note"
                type="text"
                name="dietaryNote"
                maxLength={DIETARY_NOTE_MAX}
                placeholder={t("ready.dietaryPlaceholder")}
                defaultValue={data.dietaryNote ?? ""}
                className={controlClass}
              />
            </Field>
          </div>
        ) : null}
        {/* Help requests switched off (the Features page) take no new ask: the
            question goes, a request already open still says where it stands
            and can be withdrawn, and the shop's own contact stands in for the
            question so a diver who needs a hand still knows who to ask
            (review 2026-10-23, item 3). */}
        {data.helpRequestsOn || data.helpRequest || shopReachable ? (
          <div className="py-5">
            <h3 className="text-base font-semibold">{t("ready.helpHeading")}</h3>
            {data.helpRequestsOn ? (
              <p className="mt-1 text-sm text-muted">{t("ready.helpBody")}</p>
            ) : null}
            {/* A handled request names nobody: "{name} will help you" is a
              promise, and the helper may have left the boat since. */}
            {data.helpRequest?.status === "handled" ? (
              <p className="mt-3 text-base font-medium text-success-strong">
                {t("ready.helpHandled")}
              </p>
            ) : (
              <>
                {data.helpRequestsOn ? (
                  <fieldset className="mt-3 flex flex-col gap-2">
                    <legend className="sr-only">{t("ready.helpHeading")}</legend>
                    <RadioRow
                      name="kind"
                      value="none"
                      label={t("ready.helpNone")}
                      defaultChecked={!data.helpRequest}
                    />
                    <RadioRow
                      name="kind"
                      value="carry_gear"
                      label={t("ready.helpCarryGear")}
                      defaultChecked={data.helpRequest?.kind === "carry_gear"}
                    />
                    <RadioRow
                      name="kind"
                      value="first_timer"
                      label={t("ready.helpFirstTimer")}
                      defaultChecked={data.helpRequest?.kind === "first_timer"}
                    />
                    <RadioRow
                      name="kind"
                      value="find_group"
                      label={t("ready.helpFindGroup")}
                      defaultChecked={data.helpRequest?.kind === "find_group"}
                    />
                  </fieldset>
                ) : null}
                {data.helpRequest ? (
                  <p className="mt-3 text-base font-medium text-success-strong">
                    {data.helpRequest.status === "acknowledged" && data.helpRequest.helperPersonName
                      ? meetingInfo.length > 0
                        ? t("ready.helpAcknowledged", {
                            name: data.helpRequest.helperPersonName,
                            meeting: meetingInfo.join(" · "),
                          })
                        : t("ready.helpAssignedFallback", {
                            name: data.helpRequest.helperPersonName,
                          })
                      : t("ready.helpSent")}
                  </p>
                ) : null}
                {/* Off, the radios are gone, so withdrawing is its own button:
                    it posts the one answer the save still takes. */}
                {data.helpRequest && !data.helpRequestsOn ? (
                  <SubmitButton
                    name="kind"
                    value="none"
                    pendingLabel={t("common.saving")}
                    className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}
                  >
                    {t("ready.helpWithdraw")}
                  </SubmitButton>
                ) : null}
              </>
            )}
            {!data.helpRequestsOn && shopReachable ? (
              <>
                <p className="mt-3 text-sm text-muted">{t("ready.helpAskShop")}</p>
                <ShopContactLinks
                  phone={data.shop.contactPhone}
                  email={data.shop.contactEmail}
                  className="text-sm"
                />
              </>
            ) : null}
          </div>
        ) : null}
        {/* **A word to the crew** (issue #1182, delight report D22). Rendered
            only when there is something to offer: a first trip with this shop,
            or a return after a long gap. Budget rule 6's grammar, in order: the
            question names the fact it would share, the line under it says who
            sees it and for how long, and the box is the way back as much as the
            way in (`welcomeAsked` tells the save an unticked box is an answer).
            Nothing is shared until the diver ticks it and saves. */}
        {data.welcomeOffer ? (
          <div className="py-5">
            <h3 className="text-base font-semibold">
              {data.welcomeOffer.kind === "first_trip"
                ? t("ready.welcomeFirstTripQuestion")
                : t("ready.welcomeReturningQuestion", { years: data.welcomeOffer.years })}
            </h3>
            <p className="mt-1 text-sm text-muted">{t("ready.welcomeAudience")}</p>
            <input type="hidden" name="welcomeAsked" value="1" />
            <ChoiceRow
              type="checkbox"
              name="welcomeShare"
              value="on"
              defaultChecked={data.welcomeShared}
              className="mt-3 text-base"
            >
              {t("ready.welcomeShareLabel")}
            </ChoiceRow>
            {data.welcomeShared ? (
              <p className="mt-2 text-sm font-medium text-success-strong">
                {t("ready.welcomeShared")}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="pt-2">
        <SubmitButton pendingLabel={t("common.saving")} className={buttonClass({ size: "sm" })}>
          {t("ready.dayOfSave")}
        </SubmitButton>
      </div>
    </form>
  );
}
