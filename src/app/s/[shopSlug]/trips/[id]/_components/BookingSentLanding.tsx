import { EntryDone } from "@/components/account/EntryShell";
import type { DiverTranslator } from "@/i18n/messages";

/**
 * **Where a booking for an already-held seat lands** (issue #2691, Aaron's
 * 2026-10-24 decision): a repeat address, or a party rolled back because one
 * member holds a seat (`bookSpot` redirects both to `?sent=1`). The page
 * renders it before the departure is read, and it says nothing about anybody,
 * so it cannot tell its visitor whether an address is on the manifest. The
 * answer is the email each of them is sent.
 */
export function BookingSentLanding({ t }: { t: DiverTranslator }) {
  return <EntryDone glyph="sent" title={t("booking.sentHeading")} text={t("booking.sentBody")} />;
}
