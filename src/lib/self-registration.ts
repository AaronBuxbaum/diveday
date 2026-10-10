import type { CertificationAgency } from "@/db/schema";
import { CERTIFICATION_AGENCIES } from "./certification-options";
import { homeNumberingArea, toE164 } from "./phone";

/**
 * **The shop's QR door: a diver puts themselves on file before any booking
 * exists** (issue #1236).
 *
 * Twelve of the 32 products surveyed on 2026-09-01 offer QR or tablet self
 * check-in, and the two strongest 2026 newcomers make it the centre of their
 * pitch — ScubaHub's Drop Dive case study reports pre-arrival onboarding going
 * from 0% to 90–95% and check-in from five or six minutes to under one.
 * DiveDay's waiver arrived on a booking- or person-scoped link a staffer had to
 * issue, so a walk-in who had not booked had no door of their own.
 *
 * This module is the framework-free half: the form's shape, and the one rule
 * that shapes everything around it.
 *
 * ### The rule: the visitor is told nothing about themselves
 *
 * The write matches a returning diver by email, exactly as the importer does.
 * The *response* must not. If a returning diver's submission looked any
 * different from a new one's — a different message, a redirect somewhere else,
 * a visibly skipped step — then an anonymous visitor could type any email
 * address and learn whether that person is a customer of this shop. Medical
 * referral is the same class of leak in a worse form: a hard block is a fact
 * about the diver's health, and it belongs to the shop.
 *
 * So there is exactly one success outcome (`SELF_REGISTRATION_DONE`), and it is
 * the same page whether the person was created or found, whether a waiver was
 * sent or was already on file, and whether their answers refer them to a
 * physician or clear them outright. The shop learns all of it; the screen says
 * the same sentence either way.
 */

/** What the diver claims about their own certification. Never evidence. */
export const SELF_DECLARED_LEVELS = [
  "open_water",
  "advanced_open_water",
  "rescue",
  "divemaster",
  "instructor",
] as const;

export type SelfDeclaredLevel = (typeof SELF_DECLARED_LEVELS)[number];

/**
 * Agencies whose cards a walk-up diver may not name as their own (issue #2130).
 *
 * The form asks for the card a diver *starts* with, so it offers every agency
 * that issues an entry-level (Open Water) card: TDI, IANTD and GUE do, and a
 * diver holding one used to have to pick "Other" and wait for a staffer to fix
 * it. NSS-CDS and NACD are left out because they certify cave divers only and
 * issue no entry-level card; offering them would be noise. Staff still record
 * either on the diver record, and the importer still reads them.
 */
const NO_ENTRY_LEVEL_CARD = ["nss_cds", "nacd"] as const satisfies readonly CertificationAgency[];

/**
 * The agencies the walk-up form offers, in the order the enum lists them, so
 * the form and the action that parses it read one list.
 */
export const SELF_DECLARED_AGENCIES = CERTIFICATION_AGENCIES.filter(
  (agency): agency is SelfDeclaredAgency =>
    !(NO_ENTRY_LEVEL_CARD as readonly string[]).includes(agency),
) as unknown as readonly [SelfDeclaredAgency, ...SelfDeclaredAgency[]];

export type SelfDeclaredAgency = Exclude<CertificationAgency, (typeof NO_ENTRY_LEVEL_CARD)[number]>;

/**
 * The one success state, and the only one a visitor may distinguish.
 *
 * A string rather than a boolean so the form state reads at the call site, and
 * so a future second *public* outcome has to be added here deliberately rather
 * than by somebody returning a different message from one branch.
 */
export const SELF_REGISTRATION_DONE = "done" as const;

/**
 * What the form hands back to its own client component.
 *
 * `error` is only ever about the submission itself — a missing name, an
 * unreadable date, a rate limit, a shop that does not exist. It is never about
 * *the person*: "we already have you" and "your answers need a doctor" are both
 * facts about a diver that this surface must not state.
 */
export type SelfRegistrationFormState =
  | { status?: undefined; error?: string }
  | { status: typeof SELF_REGISTRATION_DONE; error?: undefined };

/**
 * A registration the shop can act on has to be reachable. The form asks for
 * both and requires neither alone, because a diver at a counter may have only
 * one — but with neither, the row records a stranger nobody can contact, and
 * the waiver this exists to start has nowhere to go.
 *
 * The same shape `submitInquiryAction`'s `hasReplyPath` uses, and for the same
 * reason; kept separate because this one also decides whether a *person* is
 * matchable, which an inquiry never is.
 */
export function hasContactPath(input: { email?: string; phone?: string }): boolean {
  return Boolean(input.email?.trim() || input.phone?.trim());
}

/**
 * Why an anonymous registrant's release will not go out by text, or null when
 * it may.
 */
export type AnonymousTextRefusal =
  | "demo_shop"
  | "unreadable_number"
  | "foreign_number"
  /** A `+1` number outside the shop's own NANP country, or in none (issue #2151). */
  | "foreign_area_code";

/**
 * **The one number the counter QR will text, or why not** (issue #2092,
 * security review 2026-10-06).
 *
 * The QR is anonymous, and a text costs the shop money per message, more for a
 * premium international route. Without a gate the form is an SMS-pumping
 * endpoint: type any number, and the shop's sender texts it. So the anonymous
 * path texts only a number in the shop's **own** country (its calling code),
 * read the way the row stores it (`toE164`), and never from a demo shop. A
 * refused number is still stored; the shop can send the release itself.
 *
 * For a `+1` shop the calling code is not enough: it is shared by the US,
 * Canada and the Caribbean, where premium routes live. So the area code must
 * be one of the shop's own country's (`homeNumberingArea`, issue #2151).
 * Staff-initiated texts are not gated here: a person chose that recipient.
 */
export function anonymousTextRecipient(
  phone: string | null | undefined,
  shop: { addressCountry: string | null; isDemo: boolean },
):
  | { recipient: string; refused?: undefined }
  | { recipient?: undefined; refused: AnonymousTextRefusal } {
  if (shop.isDemo) return { refused: "demo_shop" };
  const e164 = toE164(phone, shop.addressCountry);
  if (!e164) return { refused: "unreadable_number" };
  const area = homeNumberingArea(e164, shop.addressCountry);
  if (area === "foreign_code") return { refused: "foreign_number" };
  if (area === "foreign_area_code") return { refused: "foreign_area_code" };
  return { recipient: e164 };
}
