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
 * **It is never a quiet door of its own.** The doors below are places to go;
 * this is a second thing to say, and it belongs beside the first one.
 *
 * `print:hidden` in full. The record is a logbook page a divemaster signs, and
 * what a diver privately asked the shop to fix is not a fact of the day.
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
    <section className="mt-10 print:hidden" aria-labelledby="recap-pulse-heading">
      <h2 id="recap-pulse-heading" className="text-base font-semibold">
        {t("recap.pulseHeading")}
      </h2>
      {/* Audience and exposure, which is what a person deciding whether to type
          this actually needs to know (Budget rule 6). The way back is the
          button below, and it is visible whenever there is something to take
          back — a sentence describing a button in view earns nothing. */}
      <p className="mt-1 text-sm text-muted">{t("recap.pulseAudience", { shop: shopName })}</p>

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
    </section>
  );
}
