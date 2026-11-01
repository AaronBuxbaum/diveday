import Link from "next/link";
import { formNoteLinkClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * What a diver agrees to by giving a mobile number: which texts, how often, and
 * how to stop them (ADR 20261007-sms-stop-and-help). It sits under every phone
 * field a diver fills in for themselves, because that field *is* the opt-in the
 * carriers verify DiveDay's texting number against, and one wording everywhere
 * is what the registration describes.
 */
export function SmsConsentNote({ t }: { t: Pick<DiverTranslator, "rich"> }) {
  return t.rich("common.smsConsent", {
    a: (chunks) => (
      <Link href="/privacy" className={formNoteLinkClass}>
        {chunks}
      </Link>
    ),
  });
}

/**
 * The phone `Field`'s `className` that shows the note only once the box holds a
 * number, by CSS alone (visual review 2026-10-24, B22). The words are always in
 * the server HTML, so a form posted before hydration, with scripts off, or
 * autofilled without an event still carried them (H-20260724-channel-sends-booking-waiver). The input needs
 * `placeholder=" "`: `:placeholder-shown` is how CSS tells an empty box.
 */
export const SMS_CONSENT_ONCE_FILLED = "[&_input:placeholder-shown~[id$='-description']]:hidden";
