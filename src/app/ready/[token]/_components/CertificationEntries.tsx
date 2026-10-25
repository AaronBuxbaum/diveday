import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { certificationAgency, certificationLevel, type DiveSpecialty } from "@/db/schema";
import type { DiverTranslator } from "@/i18n/messages";
import {
  DIVER_CERTIFICATION_AGENCY_KEYS,
  DIVER_CERTIFICATION_LEVEL_KEYS,
  DIVER_SPECIALTY_KEYS,
} from "@/i18n/readiness-labels";
import type { ReadinessBlockerCode } from "@/lib/readiness";
import type { DiverChecklistItem } from "@/lib/readiness-summary";
import {
  declareNoCertificationFromReady,
  saveCertificationFromReady,
  saveNitroxCertificationFromReady,
  saveSpecialtyFromReady,
} from "../cert-actions";

/**
 * Which cert blockers a diver can actually answer by typing their card in.
 *
 * `certification_pending` is deliberately absent: that card is already on file
 * and waiting on a staff review, so offering the form again would only invite a
 * duplicate the unique index refuses. The four here all mean the shop is
 * holding nothing usable.
 *
 * `certification_self_declared` belongs in that group and not with `pending`,
 * which is the whole reason it is its own code. A diver who picked a level on a
 * public opt-in has a `pending` row with **no card number in it** — there is
 * nothing for a unique index to collide with, nothing for a staffer to look up,
 * and if this form were withheld the diver would be told their card was being
 * verified while holding the only copy of it (ADR 20260814-self-declared-cards).
 *
 * `certification_not_yet` is "waiting" (the diver has answered), so it never
 * arrives in `actionable`; `notYet` below carries it instead.
 */
const CERT_ENTRY_CODES = new Set<ReadinessBlockerCode>([
  "certification_missing",
  "certification_self_declared",
  "certification_insufficient",
]);

/**
 * Where "I'm not certified yet" is offered (third UX review, item 23): the
 * shop holds nothing for the diver, so a first-timer is looking at agency,
 * level and number with nothing to pick. Never on `insufficient`, where a card
 * is on file and the statement would be refused (`card_on_file`).
 */
const NOT_YET_OFFER_CODES = new Set<ReadinessBlockerCode>([
  "certification_missing",
  "certification_self_declared",
]);

/**
 * A specialty card the diver can send: the trip named one and nothing on file
 * answers it. `specialty_import_unconfirmed` and `specialty_pending` are absent
 * for the same reason `certification_pending` is — a real card is already with
 * the shop, and asking again would tell a diver to re-send what they already
 * sent.
 *
 * Offering this at all took a schema change. `specialty_certifications` had no
 * `self_declared_at` column until 2026-08-20, so a row a diver typed was
 * byte-for-byte a staff transcription and the staff list's ordinary one-tap
 * confirm would have promoted an invented number to `verified` — the state that
 * clears a depth gate past 18 m (`security-reviewer`). The column, the sighting
 * guard in `reviewSpecialtyCertification`, and the `isRealCard` fix in
 * `holdsRealCardOutsideLevels` are what this form rests on.
 */
const SPECIALTY_ENTRY_CODES = new Set<ReadinessBlockerCode>(["specialty_missing"]);

/**
 * A nitrox card, likewise. `nitrox_self_declared` is here because a claim is
 * exactly the state a number resolves; `nitrox_pending` is not, because it
 * means a staffer already holds one.
 */
const NITROX_ENTRY_CODES = new Set<ReadinessBlockerCode>([
  "nitrox_missing",
  "nitrox_self_declared",
]);

/**
 * One collapsed disclosure, the shell every card-entry form on this page wears.
 *
 * Collapsed, because the row above has already said what is outstanding and a
 * diver short three cards was being handed three stacked forms — nine fields of
 * agency/level/number between them, all open at once, on a phone.
 * Shut, the same three read as a list of three things to do, and each one is a
 * tap. `<details>` carries the open state to a screen reader itself, which is
 * why the caret is decorative (`DisclosureCaret`).
 */
function CertificationDisclosure({
  summary,
  optionalLabel,
  lead = false,
  children,
}: {
  summary: string;
  /** Rendered as a pill beside the summary. Present only on an offer the trip does not require. */
  optionalLabel?: string;
  /**
   * The step's own card: at rest its summary is the step's one action, a
   * filled primary like "Sign your waiver" and "Save rental fit" (visual
   * review 2026-10-24, B26). Open, the summary steps out of sight and the
   * form's save is the primary; it stays the focused control, so a keyboard
   * can still close it.
   */
  lead?: boolean;
  children: React.ReactNode;
}) {
  if (lead) {
    return (
      <details className="group/cert">
        <summary
          className={`${buttonClass({ variant: "primary" })} w-full list-none sm:w-auto [&::-webkit-details-marker]:hidden group-open/cert:sr-only`}
        >
          {summary}
        </summary>
        <div className="rounded-inset border border-border bg-surface-sunken/50 p-4">
          {children}
        </div>
      </details>
    );
  }
  return (
    <details className="group/cert overflow-hidden rounded-inset border border-border bg-surface-sunken/50">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-3 text-base font-semibold">
        <DisclosureCaret className="group-open/cert:rotate-90" />
        <span className="min-w-0 flex-1">{summary}</span>
        {optionalLabel ? <Badge size="sm">{optionalLabel}</Badge> : null}
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

/**
 * **Every card this departure can still take, each behind its own disclosure.**
 *
 * The certification row is one *line* but can be several *jobs*: a diver short
 * a level card, a Deep card and a nitrox card used to get one form, file it,
 * reload, and discover a second thing they had no way to see. `actionable`
 * carries every blocker that is on the diver, so all of them are answerable in
 * one sitting.
 *
 * `offerNitrox` is the one entry here that is not answering a blocker. A shop
 * that fills nitrox on this departure can take a card from a diver whose trip
 * does not demand one — and it has to be takeable *here*, because the gear
 * row's request box is now locked until a card is on file. It wears an
 * "Optional" pill so a list of things the boat is waiting on never quietly
 * grows an item it is not.
 */
export function CertificationEntries({
  token,
  item,
  offerNitrox,
  notYet,
  t,
}: {
  token: string;
  item: DiverChecklistItem;
  offerNitrox: boolean;
  /**
   * Present when the seat's level gate is unmet because the diver said "I'm
   * not certified yet" (`certification_not_yet`): the shop's try-it course, if
   * it publishes one, and the card form kept for a card found in a drawer (a
   * card on file outranks the statement in `certificationBlocker`).
   */
  notYet: { introCourse: { title: string; href: string } | null } | null;
  t: DiverTranslator;
}) {
  // Derived first, in its own pass: this used to be a flag set from inside the
  // `flatMap` below, which made whether the optional offer renders depend on a
  // side effect of building an unrelated array.
  const nitroxRequired = item.actionable.some((blocker) => NITROX_ENTRY_CODES.has(blocker.code));
  const forms: React.ReactNode[] = notYet
    ? [
        ...(notYet.introCourse
          ? [<IntroCourseDoor key="intro-course" course={notYet.introCourse} t={t} />]
          : []),
        <CertificationEntry key="certification_not_yet" token={token} t={t} />,
      ]
    : [];
  for (const blocker of item.actionable) forms.push(...entriesFor(blocker));
  function entriesFor(blocker: DiverChecklistItem["actionable"][number]): React.ReactNode[] {
    if (CERT_ENTRY_CODES.has(blocker.code)) {
      // The filled primary only where the shop holds nothing (B26 review,
      // dde-a F2): on `insufficient` a card is on file, re-typing it reads
      // "Nothing more to do", and the step's own line sends the diver to the
      // shop, so the form stays the quiet disclosure it was.
      const entries = [
        <CertificationEntry
          key={blocker.code}
          token={token}
          lead={NOT_YET_OFFER_CODES.has(blocker.code)}
          t={t}
        />,
      ];
      if (NOT_YET_OFFER_CODES.has(blocker.code)) {
        entries.push(<NotYetAnswer key="not-yet" token={token} t={t} />);
      }
      return entries;
    }
    if (SPECIALTY_ENTRY_CODES.has(blocker.code) && blocker.params?.specialty) {
      return [
        <SpecialtyEntry
          key={`${blocker.code}-${blocker.params.specialty}`}
          token={token}
          specialty={blocker.params.specialty}
          t={t}
        />,
      ];
    }
    if (NITROX_ENTRY_CODES.has(blocker.code)) {
      return [<NitroxEntry key={blocker.code} token={token} t={t} />];
    }
    return [];
  }
  // Never both: a trip that demands nitrox already rendered the required one
  // above, and a second disclosure calling the same card optional would be the
  // page contradicting itself.
  if (offerNitrox && !nitroxRequired) {
    forms.push(<NitroxEntry key="nitrox-optional" token={token} optional t={t} />);
  }
  if (forms.length === 0) return null;
  return <div className="flex flex-col gap-3">{forms}</div>;
}

/**
 * The diver's own card, typed in.
 *
 * **Capture, never clearance.** The card lands `pending` and a staff review is
 * what makes it count toward readiness (`src/db/readiness.ts`), so nothing here
 * can clear the diver's own gate — which is why it can be offered behind a
 * bearer link at all. The copy says so plainly rather than implying the row is
 * settled.
 *
 * Before this, the checklist named "we still need your certification card" and
 * offered no way to answer it, so the card arrived as a photo in a reply-to
 * email or not until the dock (2026-08-06 review).
 */
function CertificationEntry({
  token,
  lead = false,
  t,
}: {
  token: string;
  /** The step's resting action, a filled primary (B26); quiet otherwise. */
  lead?: boolean;
  t: DiverTranslator;
}) {
  return (
    <CertificationDisclosure summary={t("ready.certHeading")} lead={lead}>
      <form action={saveCertificationFromReady.bind(null, token)} className="flex flex-col gap-3">
        <p className="text-sm text-muted">{t("ready.certBody")}</p>
        <FieldGrid columns={2}>
          <Field label={t("ready.certAgency")}>
            <select name="agency" required defaultValue="" className={controlClass}>
              <option value="" disabled>
                {t("ready.certChoose")}
              </option>
              {certificationAgency.enumValues.map((agency) => (
                <option key={agency} value={agency}>
                  {t(DIVER_CERTIFICATION_AGENCY_KEYS[agency])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("ready.certLevel")}>
            <select name="level" required defaultValue="" className={controlClass}>
              <option value="" disabled>
                {t("ready.certChoose")}
              </option>
              {certificationLevel.enumValues.map((level) => (
                <option key={level} value={level}>
                  {t(DIVER_CERTIFICATION_LEVEL_KEYS[level])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("ready.certNumber")}>
            <input
              name="identifier"
              required
              minLength={2}
              maxLength={60}
              autoComplete="off"
              // A card number is printed in caps and read off plastic at arm's
              // length; a phone keyboard's own autocorrect is nothing but a
              // source of wrong digits here.
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel={t("ready.certSubmitting")}
            // The step's one action, as every step's is (visual review
            // 2026-10-24, B26).
            className={buttonClass({ variant: "primary" })}
          >
            {t("ready.certSubmit")}
          </SubmitButton>
        </div>
      </form>
    </CertificationDisclosure>
  );
}

/**
 * **The honest answer for a diver with no card** (third UX review, item 23).
 *
 * The sale does not ask for a rung (Aaron, 2026-08-27), so a first-timer meets
 * agency, level and number here with nothing to pick. One tap records their
 * word (`declareNoCertificationFromReady`); the step then says the crew will
 * get in touch before the day, and Today names the reason. It clears nothing.
 *
 * **Asked once**, the shape Running late has (RunningLate.tsx): the diver
 * cannot take the statement back from this page, only a card can supersede it.
 */
function NotYetAnswer({ token, t }: { token: string; t: DiverTranslator }) {
  return (
    <form
      action={declareNoCertificationFromReady.bind(null, token)}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
    >
      <span className="text-muted">{t("ready.certNotYetLead")}</span>
      <InlineConfirm
        triggerLabel={t("ready.certNotYetButton")}
        triggerClassName={buttonClass({ variant: "ghost", size: "sm" })}
        message={t("ready.certNotYetConfirm")}
        confirmLabel={t("ready.certNotYetConfirmButton")}
        cancelLabel={t("ready.neverMind")}
        pendingLabel={t("common.saving")}
        confirmClassName={buttonClass({ size: "sm" })}
      />
    </form>
  );
}

/**
 * Once the diver has said "not yet": the shop's try-it course, the one door
 * that gets a non-diver into the water. Absent when the shop publishes none,
 * and the checklist line already says the shop will get in touch. Worded as
 * where to start, not "first": the trip may be gated well above Open Water,
 * and this component never sees its level.
 */
function IntroCourseDoor({
  course,
  t,
}: {
  course: { title: string; href: string };
  t: DiverTranslator;
}) {
  return (
    <div>
      <Link href={course.href} className={buttonClass({ variant: "secondary", size: "sm" })}>
        {t("ready.certNotYetHowToStart", { course: course.title })}
      </Link>
    </div>
  );
}

/**
 * A specialty card, typed in. Same contract as the level card above — the row
 * lands `pending` and only a staff sighting makes it count — with one
 * difference the schema enforces rather than the form: the number is required,
 * because `specialty_certifications.identifier` is `NOT NULL` and that table
 * carries no self-declaration column. A specialty is what authorizes a
 * materially riskier dive, so there is no version of it that is only a claim.
 *
 * The specialty itself is fixed by the blocker, not chosen: the trip asked for
 * Deep, so this is the Deep form. Offering a picker would invite a diver to
 * file the card they have instead of the one they were asked for.
 */
function SpecialtyEntry({
  token,
  specialty,
  t,
}: {
  token: string;
  specialty: DiveSpecialty;
  t: DiverTranslator;
}) {
  const specialtyName = t(DIVER_SPECIALTY_KEYS[specialty]);
  return (
    <CertificationDisclosure summary={t("ready.specialtyHeading", { specialty: specialtyName })}>
      <form action={saveSpecialtyFromReady.bind(null, token)} className="flex flex-col gap-3">
        <input type="hidden" name="specialty" value={specialty} />
        <FieldGrid columns={2}>
          <Field label={t("ready.certAgency")}>
            <select name="agency" required defaultValue="" className={controlClass}>
              <option value="" disabled>
                {t("ready.certChoose")}
              </option>
              {certificationAgency.enumValues.map((agency) => (
                <option key={agency} value={agency}>
                  {t(DIVER_CERTIFICATION_AGENCY_KEYS[agency])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("ready.certNumber")}>
            <input
              name="identifier"
              required
              minLength={2}
              maxLength={60}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel={t("ready.certSubmitting")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("ready.certSubmit")}
          </SubmitButton>
        </div>
      </form>
    </CertificationDisclosure>
  );
}

/**
 * A nitrox card, typed in. No level and no expiry — a nitrox card is a yes/no
 * qualification and `nitrox_certifications` has no expiry state at all
 * (`src/lib/readiness.ts` raises no `nitrox_expired`).
 *
 * `optional` is the case where the trip demands nothing and the shop simply
 * fills enriched air: the card is what makes the gear row's request box appear
 * at all, so the offer belongs here with the other cards — pilled, so it never
 * reads as one more thing standing between the diver and the boat.
 *
 * This is also where "what is nitrox?" is answered (issue 627). It used to sit
 * on the gear row's request legend, which a diver only reaches *after* filing a
 * card — the explanation arriving one step after the decision it was for. Here
 * it meets them at the word itself.
 */
function NitroxEntry({
  token,
  optional = false,
  t,
}: {
  token: string;
  optional?: boolean;
  t: DiverTranslator;
}) {
  return (
    <CertificationDisclosure
      summary={t("ready.nitroxCertHeading")}
      optionalLabel={optional ? t("ready.certOptional") : undefined}
    >
      <form
        action={saveNitroxCertificationFromReady.bind(null, token)}
        className="flex flex-col gap-3"
      >
        {/* What the word means, said plainly rather than hidden behind a
            marker. This is the gear row's old `InfoHint` detail, moved to the
            section that asks for the card (issue 627) — as text, because an
            `InfoHint` is a `<button>` and `<summary>` is already one, and
            because this page is read on a phone, where there is no hover to
            discover. Same string, so the booking page's hint and this cannot
            drift apart. */}
        <p className="text-sm text-muted">{t("rental.jargonHints.nitrox")}</p>
        <FieldGrid columns={2}>
          <Field label={t("ready.certAgency")}>
            <select name="agency" required defaultValue="" className={controlClass}>
              <option value="" disabled>
                {t("ready.certChoose")}
              </option>
              {certificationAgency.enumValues.map((agency) => (
                <option key={agency} value={agency}>
                  {t(DIVER_CERTIFICATION_AGENCY_KEYS[agency])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("ready.certNumber")}>
            <input
              name="identifier"
              required
              minLength={2}
              maxLength={60}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <div>
          <SubmitButton
            pendingLabel={t("ready.certSubmitting")}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            {t("ready.certSubmit")}
          </SubmitButton>
        </div>
      </form>
    </CertificationDisclosure>
  );
}
