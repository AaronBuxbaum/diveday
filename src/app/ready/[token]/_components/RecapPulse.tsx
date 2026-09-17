import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, FormStatus } from "@/components/ui/form";
import {
  MAX_RECAP_PULSE_NOTE_LENGTH,
  RECAP_PULSE_CATEGORIES,
  type RecapPulseCategory,
} from "@/db/recap-pulses";
import type { DiverMessageKey, DiverTranslator } from "@/i18n/messages";
import { RECAP_PULSE_CATEGORY_KEYS } from "@/i18n/next-dive-labels";
import { noticeFromParam } from "@/lib/staff-notices";

/**
 * **The other door** — delight report D40 (issue #1200), slice 16i of ADR
 * 20260904-reef-all-the-way-down.
 *
 * The review above this asks a diver to say something in public. A diver whose
 * regulator free-flowed has nothing to do with that ask, so today they say
 * nothing and the shop learns nothing it could have fixed. This is the second
 * door and it is deliberately *under* the review rather than inside it: a
 * private field in a public form is a trap, and a diver who has already
 * submitted a review must still be able to reach this.
 *
 * **It is the first quiet door, and it renders the door's body only.** The
 * heading, the disclosure and the closed-at-rest default belong to `Door` in
 * `AfterState.tsx`. This was a standing section at the review's own weight
 * until 2026-09-17 — five chips, a textarea and a send button all open beside
 * the review's five stars, a textarea and a send button, so one page asked one
 * question twice at equal weight. A complaint is a minority act at a minority
 * moment, which is what disclosure is for (principle 8).
 *
 * `print:hidden` is the door's. The record is a logbook page a divemaster
 * signs, and what a diver privately asked the shop to fix is not a fact of the
 * day.
 *
 * Words come from the bundle and codes from `src/db/recap-pulses.ts`; the five
 * chips are `RECAP_PULSE_CATEGORIES` in the enum's own order, so a sixth
 * category is a compile error here rather than a chip nobody added.
 */

const PULSE_NOTICES: Record<string, { tone: "success" | "danger"; key: DiverMessageKey }> = {
  saved: { tone: "success", key: "recap.pulseSaved" },
  withdrawn: { tone: "success", key: "recap.pulseWithdrawn" },
  empty: { tone: "danger", key: "recap.pulseEmpty" },
  // A cancelled or no-show booking never dived — "pick a category and try
  // again" would send them round a loop that can never succeed.
  did_not_dive: { tone: "danger", key: "recap.pulseFailed" },
  error: { tone: "danger", key: "recap.pulseFailed" },
};

/**
 * Whether `?pulse=` names an outcome this render has to report — which is the
 * only reason the door above opens on arrival for a diver who has said nothing
 * yet. Exported rather than letting the caller test the raw param: the param is
 * attacker-supplied, and `noticeFromParam` is the one thing that decides
 * whether a value is real. `?pulse=constructor` opens nothing, the same way it
 * says nothing.
 */
export function hasRecapPulseNotice(notice?: string): boolean {
  // `undefined`, not `null` — `noticeFromParam` returns `undefined` for both a
  // missing param and an unrecognised one, and a `!== null` test here is true
  // for every value on earth, which opened the door on arrival for everybody.
  return noticeFromParam(notice, PULSE_NOTICES) !== undefined;
}

export function RecapPulse({
  t,
  shopName,
  ownPulse,
  notice,
  action,
}: {
  t: DiverTranslator;
  shopName: string;
  /** What this diver already said, so the form opens on it. */
  ownPulse: { categories: RecapPulseCategory[]; note: string | null } | null;
  /** `?pulse=`, straight off the URL and never trusted. */
  notice?: string;
  action: (formData: FormData) => void | Promise<void>;
}) {
  // `noticeFromParam`, never a bare `PULSE_NOTICES[notice]`: the param is
  // attacker-supplied and a bare lookup walks the prototype.
  const resolved = noticeFromParam(notice, PULSE_NOTICES);
  const chosen = new Set(ownPulse?.categories ?? []);

  return (
    <>
      {/* Who reads it, which is what a person deciding whether to type this
          actually needs to know (Budget rule 6) and the one thing the door's
          own summary does not say. It used to carry "Never on your review, and
          never public" too; the summary says "privately" two lines above, and a
          sentence restating the heading it sits under is the first deletion
          (copy-restraint #1). The way back is the button below, and it is
          visible whenever there is something to take back — a sentence
          describing a button in view earns nothing. */}
      <p className="text-base text-muted">{t("recap.pulseAudience", { shop: shopName })}</p>

      <form action={action} className="mt-4 flex flex-col gap-3">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">{t("recap.pulseHeading")}</legend>
          {RECAP_PULSE_CATEGORIES.map((category) => (
            <label
              key={category}
              className="flex min-h-11 cursor-pointer items-center rounded-lg border border-border px-4 text-sm font-medium has-checked:border-primary has-checked:bg-primary-tint has-checked:text-primary"
            >
              <input
                type="checkbox"
                name="category"
                value={category}
                defaultChecked={chosen.has(category)}
                className="sr-only"
              />
              {t(RECAP_PULSE_CATEGORY_KEYS[category])}
            </label>
          ))}
        </fieldset>
        <label htmlFor="pulse-note" className="text-sm font-medium">
          {t("recap.pulseNoteLabel")}
        </label>
        <textarea
          id="pulse-note"
          name="note"
          rows={2}
          maxLength={MAX_RECAP_PULSE_NOTE_LENGTH}
          defaultValue={ownPulse?.note ?? ""}
          className={controlClass}
        />
        {/* Beside the form, never a page banner (docs/design/forms-and-controls.md). */}
        {resolved ? (
          <FormStatus tone={resolved.tone}>
            {resolved.key === "recap.pulseSaved" || resolved.key === "recap.pulseWithdrawn"
              ? t(resolved.key, { shop: shopName })
              : t(resolved.key)}
          </FormStatus>
        ) : null}
        <div>
          <SubmitButton
            pendingLabel={t("recap.pulseSending")}
            className={buttonClass({ variant: "secondary" })}
          >
            {t("recap.pulseSubmit")}
          </SubmitButton>
        </div>
      </form>

      {/* **The way back**, and only once there is something to take back.
          A form of its own rather than a second button in the one above, because
          what withdraws a pulse is a submit carrying no `category` at all
          (`submitRecapPulse`, src/db/recap-pulses.ts) — and a button inside that
          form would carry whichever chips are ticked. Two forms, two posts, one
          action, and the difference between them is exactly the difference the
          writer reads. */}
      {ownPulse ? (
        <form action={action} className="mt-3">
          <SubmitButton
            pendingLabel={t("recap.pulseSending")}
            className={buttonClass({ variant: "link", size: "sm", flush: true })}
          >
            {t("recap.pulseWithdraw")}
          </SubmitButton>
        </form>
      ) : null}
    </>
  );
}
