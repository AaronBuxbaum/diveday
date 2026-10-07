import Link from "next/link";
import { proseLinkClass } from "@/components/ui/button";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * What a diver agrees to by giving a mobile number: which texts, how many, and
 * how to stop them (ADR 20261007-sms-stop-and-help). It sits under every phone
 * field a diver fills in for themselves, because that field *is* the opt-in the
 * carriers verify DiveDay's texting number against, and one wording everywhere
 * is what the registration describes.
 */
export function SmsConsentNote({ t }: { t: Pick<DiverTranslator, "rich"> }) {
  return t.rich("common.smsConsent", {
    a: (chunks) => (
      <Link href="/privacy" className={proseLinkClass}>
        {chunks}
      </Link>
    ),
  });
}
