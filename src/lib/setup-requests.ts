import { z } from "zod";
import type { DiverMessageKey } from "@/i18n/messages";
import { DIVER_EMAIL_MAX } from "./person-fields";

/**
 * **A shop asking to be set up** — the public form at `/get-set-up` that
 * replaced the `mailto:onboarding@dive.day` door (ADR
 * 20261007-setup-request-form).
 *
 * Every shop is still opened by hand (ADR 20260925-shops-are-set-up-by-hand);
 * what changed is how the ask arrives. A mail link fails on a phone with no
 * mail client, carries no funnel tag, and captures nothing from a reader who
 * hesitates. The form asks the questions the first reply always asked anyway,
 * keeps the tag, and writes a row before anybody's inbox is involved.
 *
 * Codes and shapes only. The words are `marketing.setUp.*` in the diver
 * bundle, chosen by the page.
 */

/** What a shop runs its days on today — the first question of every set-up call. */
export const SETUP_CURRENT_SYSTEMS = [
  "paper",
  "spreadsheet",
  "booking_system",
  "shop_software",
  "other",
] as const;

export type SetupCurrentSystem = (typeof SETUP_CURRENT_SYSTEMS)[number];

/** Where each answer's words live in the diver bundle. */
export const SETUP_CURRENT_SYSTEM_KEYS: Record<SetupCurrentSystem, DiverMessageKey> = {
  paper: "marketing.setUp.current.paper",
  spreadsheet: "marketing.setUp.current.spreadsheet",
  booking_system: "marketing.setUp.current.bookingSystem",
  shop_software: "marketing.setUp.current.shopSoftware",
  other: "marketing.setUp.current.other",
};

/**
 * **The honeypot.** A text box no person sees — off screen, out of the tab
 * order, hidden from assistive technology, `autocomplete="off"` — that a form
 * bot fills in because it fills in everything. A submission carrying a value
 * here is answered exactly like a real one (the thank-you page), so the bot
 * learns nothing, and nothing is stored, sent or counted.
 *
 * Named like a field a bot expects to complete rather than like a trap.
 */
export const SETUP_HONEYPOT_FIELD = "website";

/** Whether a submission tripped the honeypot. Any non-blank value does. */
export function trippedHoneypot(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** The fields a person fills in, in the order the form asks them. */
export const SETUP_FIELDS = [
  "shopName",
  "region",
  "runsBoat",
  "currentSystem",
  "contactName",
  "email",
  "phone",
] as const;

export type SetupField = (typeof SETUP_FIELDS)[number];

/** Why one field was refused. The page picks the sentence. */
export type SetupFieldError = "required" | "invalid";

/**
 * **The real cap on set-up requests**, from everyone together, per rolling
 * hour. Each one mails the onboarding inbox, so the per-IP limit alone would
 * let a rotating pool of addresses fill it. Counted from the table before each
 * insert, so it holds across server instances, which the in-memory rate-limit
 * bucket does not. Thirty is far above any real week and well below a flood.
 */
export const SETUP_REQUESTS_PER_HOUR = 30;

export const SETUP_TEXT_MAX = 120;
export const SETUP_PHONE_MAX = 30;

/**
 * Line breaks, control and format characters (bidi overrides, zero-width
 * joiners) and the Unicode line and paragraph separators are refused in every
 * typed answer: each one lands in a mail (the shop name and region in its
 * subject), where they can break a header or disguise what the text says, and
 * none belongs in a one-line answer. Shared with the `setup_request_alert`
 * notification schema, so the mail refuses them even if a caller skipped this
 * parser.
 */
const UNSAFE_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Whether a one-line answer is free of every character `UNSAFE_CHARACTER` refuses. */
export function isSingleLineText(value: string): boolean {
  return !UNSAFE_CHARACTER.test(value);
}

/** Digits and the punctuation people write phone numbers with, nothing else. */
const PHONE_SHAPE = /^[+\d\s().-]*$/;

const requiredText = (max: number) =>
  z.string().trim().min(1, "required").max(max, "invalid").refine(isSingleLineText, "invalid");

const setupRequestSchema = z.object({
  shopName: requiredText(SETUP_TEXT_MAX),
  region: requiredText(SETUP_TEXT_MAX),
  runsBoat: z.enum(["yes", "no"], { error: "required" }).transform((value) => value === "yes"),
  currentSystem: z.enum(SETUP_CURRENT_SYSTEMS, { error: "required" }),
  contactName: requiredText(SETUP_TEXT_MAX),
  email: z
    .string()
    .trim()
    .min(1, "required")
    .max(DIVER_EMAIL_MAX, "invalid")
    .pipe(z.email("invalid"))
    .transform((value) => value.toLowerCase()),
  phone: z
    .string()
    .trim()
    .max(SETUP_PHONE_MAX, "invalid")
    .regex(PHONE_SHAPE, "invalid")
    .transform((value) => (value ? value : null)),
});

export type SetupRequestInput = z.output<typeof setupRequestSchema>;

export type SetupRequestParse =
  | { ok: true; data: SetupRequestInput }
  | { ok: false; fieldErrors: Partial<Record<SetupField, SetupFieldError>> };

/**
 * Judge one submission. Every field arrives as whatever a crafted POST put
 * there, so anything that is not a string reads as blank; a refusal names the
 * field and the reason as codes, one per field.
 */
export function parseSetupRequest(raw: Partial<Record<SetupField, unknown>>): SetupRequestParse {
  const asText = (value: unknown) => (typeof value === "string" ? value : "");
  const parsed = setupRequestSchema.safeParse(
    Object.fromEntries(SETUP_FIELDS.map((field) => [field, asText(raw[field])])),
  );
  if (parsed.success) return { ok: true, data: parsed.data };

  const fieldErrors: Partial<Record<SetupField, SetupFieldError>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || !SETUP_FIELDS.includes(field as SetupField)) continue;
    if (fieldErrors[field as SetupField]) continue;
    fieldErrors[field as SetupField] = issue.message === "required" ? "required" : "invalid";
  }
  return { ok: false, fieldErrors };
}

/**
 * What the form's action answers with when it does not redirect: the refusals
 * as codes, and what the reader typed so a refusal never costs them the form.
 * React resets an uncontrolled form after its action settles, so the values
 * ride back and the fields re-render from them.
 */
export type SetupRequestFormState = {
  fieldErrors?: Partial<Record<SetupField, SetupFieldError>>;
  formError?: "rate_limited";
  values?: Partial<Record<SetupField, string>>;
};
