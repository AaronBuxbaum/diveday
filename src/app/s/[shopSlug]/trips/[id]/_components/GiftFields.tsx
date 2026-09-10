"use client";

import { useTranslations } from "next-intl";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { DIVER_EMAIL_MAX, DIVER_NAME_MAX } from "@/lib/person-fields";

/** Matches `GIFT_MESSAGE_MAX` in the trip page's `actions.ts`. */
const GIFT_LINE_MAX = 280;

/**
 * **The gift's three questions, and the giver's own name** (ADR
 * 20260908-one-hand, decision 6, lever W).
 *
 * These replace the party fields entirely rather than joining them: a gift is
 * one seat, and every question the party form asks is about the person who will
 * be *in* it. What is left is who is diving, the line that goes on the pass,
 * and how to reach the person paying.
 *
 * **Nothing here asks about anybody's diving**, and that is the rule the whole
 * lever rests on: a gift can put a name on a boat, it can never put an unready
 * diver on one. The certification, the waiver and the medical questions are the
 * receiver's, asked for on their own claim — which is also the only place they
 * can honestly be answered.
 */
export function GiftFields({ fieldErrors }: { fieldErrors?: Record<string, string> }) {
  const t = useTranslations("booking");
  const tRoot = useTranslations();
  return (
    <FieldGrid columns={1} className="border-t border-border pt-4">
      <Field
        label={t("giftReceiverLabel")}
        error={fieldErrors?.giftReceiverName}
        htmlFor="giftReceiverName"
      >
        <input
          id="giftReceiverName"
          name="giftReceiverName"
          required
          maxLength={DIVER_NAME_MAX}
          className={controlClass}
        />
      </Field>
      <Field
        label={t("giftMessageLabel")}
        hint={tRoot("common.optional")}
        description={t("giftMessageHint")}
        error={fieldErrors?.giftMessage}
        htmlFor="giftMessage"
      >
        <input
          id="giftMessage"
          name="giftMessage"
          maxLength={GIFT_LINE_MAX}
          className={controlClass}
        />
      </Field>
      <Field
        label={t("giftGiverNameLabel")}
        error={fieldErrors?.giftGiverName}
        htmlFor="giftGiverName"
      >
        <input
          id="giftGiverName"
          name="giftGiverName"
          required
          autoComplete="name"
          maxLength={DIVER_NAME_MAX}
          className={controlClass}
        />
      </Field>
      <Field
        label={t("giftGiverEmailLabel")}
        description={t("giftGiverEmailHint")}
        error={fieldErrors?.giftGiverEmail}
        htmlFor="giftGiverEmail"
      >
        <input
          id="giftGiverEmail"
          name="giftGiverEmail"
          type="email"
          required
          autoComplete="email"
          maxLength={DIVER_EMAIL_MAX}
          className={controlClass}
        />
      </Field>
      {/* The one sentence a giver needs before they commit: what the person
          they are buying for has to do, and what happens to the money if the
          boat cannot go. It is a consequence the surface cannot show on its
          own, which is the test a sentence has to pass to exist. */}
      <p className="text-sm text-muted">{t("giftHowItWorks")}</p>
    </FieldGrid>
  );
}
