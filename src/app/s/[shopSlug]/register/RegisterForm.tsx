"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid, FormStatus } from "@/components/ui/form";
import { LEAD_TITLE_CLASS } from "@/components/ui/typography";
import {
  SELF_DECLARED_LEVELS,
  SELF_REGISTRATION_DONE,
  type SelfRegistrationFormState,
} from "@/lib/self-registration";

/**
 * The agencies this form offers, in the spelling `certifications.agency` holds.
 * A subset of `common.certification.agencies` — the ones the enum accepts — so
 * a diver never picks a name the write would then have to drop.
 */
const AGENCIES = [
  "common.certification.agencies.padi",
  "common.certification.agencies.ssi",
  "common.certification.agencies.naui",
  "common.certification.agencies.sdi",
  "common.certification.agencies.raid",
  "common.certification.agencies.bsac",
  "common.certification.agencies.cmas",
  "common.certification.agencies.other",
] as const;

/** The enum value each of those keys stands for, in the column's own spelling. */
const AGENCY_VALUES = ["padi", "ssi", "naui", "sdi", "raid", "bsac", "cmas", "other"] as const;

/**
 * The level codes as the column spells them, against the copy's own camelCase.
 * Written as whole keys rather than a template so the message id is a literal
 * the translator's type can check — a `${string}` interpolation is a key nobody
 * proves exists.
 */
const LEVEL_KEYS = {
  open_water: "course.certificationLevels.openWater",
  advanced_open_water: "course.certificationLevels.advancedOpenWater",
  rescue: "course.certificationLevels.rescue",
  divemaster: "course.certificationLevels.divemaster",
  instructor: "course.certificationLevels.instructor",
} as const;

/**
 * **The counter's QR, as a form** (issue #1236).
 *
 * A diver who has not booked anything types their name in, and the shop has a
 * person, a self-declared card and a set of sizes before they walk through the
 * door — the pre-arrival onboarding twelve of the 32 surveyed products sell and
 * DiveDay had no door for.
 *
 * **One ending, whatever happened.** The done state says the same sentence for
 * a diver the shop has never seen and for one who registered last season, and
 * for one whose medical answers will refer them to a physician. Anything else
 * would let an anonymous visitor type an address and learn who dives here —
 * the rule is stated in full in `src/lib/self-registration.ts`, and the reason
 * it lives there rather than in a comment on this file is that it constrains
 * the write, the action and this component together.
 *
 * The certification hint is the other load-bearing sentence: what the diver
 * types is filed as their own word, never as evidence, and the card is checked
 * on the day. Saying so here is what makes the honest thing the obvious thing.
 */
export function RegisterForm({
  action,
  shopName,
}: {
  // i18n-exempt: type annotation, not copy.
  action: (
    prev: SelfRegistrationFormState,
    formData: FormData,
  ) => Promise<SelfRegistrationFormState>;
  shopName: string;
}) {
  const t = useTranslations();
  const [state, formAction] = useActionState<SelfRegistrationFormState, FormData>(action, {});

  if (state.status === SELF_REGISTRATION_DONE) {
    return (
      <div className="mt-8">
        <h2 className={LEAD_TITLE_CLASS}>{t("register.doneTitle")}</h2>
        <p className="mt-2 text-muted">{t("register.doneBody", { shop: shopName })}</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-8">
      <FieldGrid columns={2}>
        <Field label={t("register.nameLabel")} htmlFor="fullName">
          <input
            id="fullName"
            name="fullName"
            required
            maxLength={120}
            autoComplete="name"
            className={controlClass}
          />
        </Field>
        <Field
          label={t("register.emailLabel")}
          // `description`, not `hint`: `hint` is the inline "(optional)" slot, and a
          // whole sentence there wraps the caption row and knocks this box out of
          // line with the one beside it.
          description={t("register.contactHint")}
          htmlFor="email"
        >
          <input
            id="email"
            name="email"
            type="email"
            maxLength={200}
            autoComplete="email"
            className={controlClass}
          />
        </Field>
        <Field label={t("register.phoneLabel")} htmlFor="phone">
          <input
            id="phone"
            name="phone"
            type="tel"
            maxLength={30}
            autoComplete="tel"
            className={controlClass}
          />
        </Field>
      </FieldGrid>

      <fieldset>
        <legend className={LEAD_TITLE_CLASS}>{t("register.certHeading")}</legend>
        <p className="mt-1 mb-4 text-sm text-muted">{t("register.certHint")}</p>
        <FieldGrid columns={2}>
          <Field label={t("register.agencyLabel")} htmlFor="agency">
            <select id="agency" name="agency" defaultValue="" className={controlClass}>
              <option value="">{t("register.agencyNone")}</option>
              {AGENCY_VALUES.map((agency, index) => (
                <option key={agency} value={agency}>
                  {t(AGENCIES[index])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("register.levelLabel")} htmlFor="level">
            <select id="level" name="level" defaultValue="" className={controlClass}>
              <option value="">—</option>
              {SELF_DECLARED_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {t(LEVEL_KEYS[level])}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("register.identifierLabel")} htmlFor="identifier">
            <input id="identifier" name="identifier" maxLength={120} className={controlClass} />
          </Field>
        </FieldGrid>
      </fieldset>

      <fieldset>
        <legend className={LEAD_TITLE_CLASS}>{t("register.sizesHeading")}</legend>
        <p className="mt-1 mb-4 text-sm text-muted">{t("register.sizesHint")}</p>
        <FieldGrid columns={3}>
          <Field label={t("register.wetsuitLabel")} htmlFor="wetsuitSize">
            <input id="wetsuitSize" name="wetsuitSize" maxLength={40} className={controlClass} />
          </Field>
          <Field label={t("register.bootLabel")} htmlFor="bootSize">
            <input id="bootSize" name="bootSize" maxLength={40} className={controlClass} />
          </Field>
          <Field label={t("register.finLabel")} htmlFor="finSize">
            <input id="finSize" name="finSize" maxLength={40} className={controlClass} />
          </Field>
        </FieldGrid>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel={t("register.submitting")} className={buttonClass()}>
          {t("register.submit")}
        </SubmitButton>
        <FormStatus tone={state.error ? "danger" : undefined}>{state.error}</FormStatus>
      </div>
    </form>
  );
}
