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
import { isDiver } from "@/lib/participant-types";
import { reEntryOffersFor } from "@/lib/re-entry";
import {
  saveDiveIntentFromReady,
  saveDiveRecencyFromReady,
  saveHelpRequestFromReady,
  saveHotelPickupLocationFromReady,
  saveNoteFromReady,
  saveReEntryAskFromReady,
  saveWelcomeConsentFromReady,
} from "../day-of-actions";

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
 * genuinely asked of everybody. The others ride inside it, save on their own
 * actions exactly as before, and gate nothing: answering none of them still
 * finishes the step, and answering one cannot blank another.
 */
export function DayOfDetails({
  token,
  data,
  t,
}: {
  token: string;
  data: ReadyPageData;
  t: DiverTranslator;
}) {
  const saveButton = buttonClass({ variant: "secondary", size: "sm" });
  const diving = isDiver(data.participantType);
  return (
    <div className="divide-y divide-border">
      {/* A seat that is not diving is not asked when it last dived, what the
          dive is for, or for a refresher (ADR 20261007-participant-types). */}
      {diving ? (
        <>
          {/* **The question nobody was asking.** A rung is what the shop gates on;
          currency is what actually catches people, and an honest "Advanced
          Open Water" from 1998 with no dive since 2013 clears every check in
          this product (ADR 20260821-currency-is-what-catches-people). It gates
          nothing — it is here because a diver whose card the shop verified
          years ago is exactly the person worth asking. */}
          <form
            action={saveDiveRecencyFromReady.bind(null, token)}
            className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end"
          >
            <Field label={t("ready.lastDivedHeading")} htmlFor="last-dived" className="flex-1">
              <select
                id="last-dived"
                name="lastDivedBand"
                required
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
            {/* In a `<div>`, like every other Save on the page: a direct child of
            the phone's `flex-col` row is stretched across the column (K-470). */}
            <div>
              <SubmitButton pendingLabel={t("ready.savingLastDived")} className={saveButton}>
                {t("ready.saveLastDived")}
              </SubmitButton>
            </div>
          </form>
          {/* **The way back.** The booking form asks this and says "change it any
          time from the link we send you" — this is that link, and it is also
          where the divers who never saw a booking form get asked at all: a
          party member, a walk-in a staffer seated. Its own save, like every
          other question on this page, so answering it cannot blank a size set
          last week (ADR 20260904-reef-all-the-way-down, D12). */}
          <form
            action={saveDiveIntentFromReady.bind(null, token)}
            className="flex flex-col gap-3 py-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label={t("ready.intentHeading")} htmlFor="dive-intent" className="flex-1">
                <select
                  id="dive-intent"
                  name="diveIntent"
                  required
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
              <div>
                <SubmitButton pendingLabel={t("ready.savingIntent")} className={saveButton}>
                  {t("ready.saveIntent")}
                </SubmitButton>
              </div>
            </div>
            {/* Who reads the answer above, in the consent grammar ADR
            20260904-reef-all-the-way-down's budget rule 6 asks of anything a
            diver shares. It stood under the same question on the public
            booking form until 2026-09-06; the second half of that line —
            "change it any time from the link we send you" — is gone, because
            this is that link.

            Inside the question's own form, under its row: as a child of the
            `divide-y` stack of its own it took a rule above it and read as the
            start of the next question (K-469). Not `Field`'s `description`,
            which sits under the select and would drag the Save beside it down
            to the line's foot from `sm`; wired to the select by id instead. */}
            <p id="dive-intent-audience" className="text-sm text-muted">
              {t("booking.intent.audience")}
            </p>
          </form>
          {/* **D18's three offers, where the answer that opens them lives** (ADR
          20260904-reef-all-the-way-down, D18). They hung off the intent chips
          on the public booking form and came here with them: a diver who has
          said this dive is about getting comfortable again is asked what would
          help, while there is still a day for the shop to do it. Both gates —
          the saved intent and the offer window — are `getReadyPageData`'s, so
          this renders exactly what `saveReEntryAskFromReady` will accept.
          Its own save, like every other question on this page. */}
          {data.reEntryOffersOpen ? (
            <form
              action={saveReEntryAskFromReady.bind(null, token)}
              className="flex flex-col gap-3 py-5"
            >
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
              {/* The one sentence here that has to exist: an offer of help on a
              readiness checklist reads as a condition unless it says it is
              not one. */}
              <p className="text-sm text-muted">{t("booking.reEntry.noGate")}</p>
              <div>
                <SubmitButton pendingLabel={t("common.saving")} className={saveButton}>
                  {t("ready.saveReEntry")}
                </SubmitButton>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
      {/* **The diver's own words.** Its own save (`saveNoteFromReady` writes
          the note column and nothing else), so answering it cannot blank sizes
          set last week, and saving sizes cannot blank it (issue 627). */}
      <form action={saveNoteFromReady.bind(null, token)} className="flex flex-col gap-3 py-5">
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
        <div>
          <SubmitButton pendingLabel={t("common.saving")} className={saveButton}>
            {t("ready.saveNote")}
          </SubmitButton>
        </div>
      </form>
      {/* The question asks about the *service*, not the address. "Where are you
          staying?" on a list of things a diver owes their shop reads as a
          records question — nobody volunteers their hotel room to a form that
          has not said why it wants it. The field under it keeps the address
          label. */}
      <div className="py-5">
        <h3 className="text-base font-semibold">{t("ready.hotelPickupLabel")}</h3>
        <form
          action={saveHotelPickupLocationFromReady.bind(null, token)}
          className="mt-3 flex flex-col gap-3"
        >
          <Field label={t("ready.hotelPickupFieldLabel")} htmlFor="hotel-pickup">
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
          <div>
            <SubmitButton pendingLabel={t("common.saving")} className={saveButton}>
              {t("ready.saveHotelPickup")}
            </SubmitButton>
          </div>
        </form>
      </div>
      <div className="py-5">
        <h3 className="text-base font-semibold">{t("ready.helpHeading")}</h3>
        <p className="mt-1 text-sm text-muted">{t("ready.helpBody")}</p>
        {data.helpRequest?.status === "handled" ? (
          <p className="mt-3 text-sm font-medium text-success-strong">{t("ready.helpHandled")}</p>
        ) : (
          <form
            action={saveHelpRequestFromReady.bind(null, token)}
            className="mt-3 flex flex-col gap-3"
          >
            <fieldset className="flex flex-col gap-2">
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
            {data.helpRequest?.status === "acknowledged" ? (
              <p className="text-sm font-medium text-success-strong">
                {t("ready.helpAcknowledged")}
              </p>
            ) : null}
            <div>
              <SubmitButton pendingLabel={t("ready.helpSaving")} className={saveButton}>
                {t("ready.helpSubmit")}
              </SubmitButton>
            </div>
          </form>
        )}
      </div>
      {/* **A word to the crew** (issue #1182, delight report D22).
          Rendered only when there is something to offer — a first trip with
          this shop, or a return after a long gap — so most divers never see
          this block at all.

          Budget rule 6's grammar, in order: the question names the fact it
          would share, the line under it says who sees it and for how long, and
          the control is the way back as much as the way in. Nothing is shared
          until the diver taps, and nothing about them is stored beyond the
          stamp — what the crew reads is derived from their own bookings. */}
      {data.welcomeOffer ? (
        <div className="py-5">
          <h3 className="text-base font-semibold">
            {data.welcomeOffer.kind === "first_trip"
              ? t("ready.welcomeFirstTripQuestion")
              : t("ready.welcomeReturningQuestion", { years: data.welcomeOffer.years })}
          </h3>
          <p className="mt-1 text-sm text-muted">{t("ready.welcomeAudience")}</p>
          <form
            action={saveWelcomeConsentFromReady.bind(null, token)}
            className="mt-3 flex flex-wrap items-center gap-3"
          >
            <input type="hidden" name="share" value={data.welcomeShared ? "off" : "on"} />
            <SubmitButton pendingLabel={t("common.saving")} className={saveButton}>
              {data.welcomeShared ? t("ready.welcomeWithdraw") : t("ready.welcomeShare")}
            </SubmitButton>
            {data.welcomeShared ? (
              <span className="text-sm font-medium text-success-strong">
                {t("ready.welcomeShared")}
              </span>
            ) : null}
          </form>
        </div>
      ) : null}
    </div>
  );
}
