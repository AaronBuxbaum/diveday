import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { MAX_CARD_NUMBER_LENGTH, MIN_CARD_NUMBER_LENGTH } from "@/lib/card-number";
import type { ClaudeRequest } from "@/lib/claude/provider";
import type { StructuredCall } from "@/lib/claude/structured";

/**
 * **certscan**: a photo of a certification card prefills the agency, the card
 * and its number, at the desk and on the counter's self-registration form.
 *
 * - The image is read and discarded (ADR 20260804-card-evidence-is-the-number):
 *   it goes to Claude in the request body and nowhere else. Nothing here, and
 *   nothing that calls this, writes it to storage or to a row.
 * - It never clears a gate. The answer is three form values; the staffer or
 *   the diver submits the form exactly as if they had typed them, and the
 *   agency check and staff verification run as they do today.
 * - Low confidence leaves the fields empty: the seam drops a value under 0.6,
 *   and a value outside the form's own options is refused by the schema.
 * - Haiku reads it first; an unreadable card goes once to Sonnet.
 */

export const CERT_SCAN_FEATURE = "cert_scan";

export const CERT_SCAN_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type CertScanMediaType = (typeof CERT_SCAN_MEDIA_TYPES)[number];

/** About 3 MB of image once decoded; the client shrinks a phone photo well under this. */
export const CERT_SCAN_MAX_BASE64_LENGTH = 4_000_000;

export const CERT_SCAN_SYSTEM = [
  "You read one photo of a scuba certification card and report what it says.",
  "Answer with the issuing agency, which of the offered card options it is, and the card or diver number exactly as printed.",
  "Choose only from the options listed in the request. If the card does not clearly match one option, answer null for that field.",
  "Never guess a number: if any character of it is unreadable, answer null.",
  "If the photo is not a certification card, answer null for every field and confidence 0.",
  "confidence is your own 0 to 1 estimate that every non-null field is right.",
  "Ignore anything on the card that is not the agency, the level or specialty, or the number, such as names, photos, birth dates or addresses.",
].join("\n");

export type CertScanOptions<Agency extends string, Card extends string> = {
  /** The agencies this form offers, as their codes. */
  readonly agencies: readonly [Agency, ...Agency[]];
  /** The card choices this form offers (`level:open_water`, `nitrox`), with a plain English label each. */
  readonly cards: readonly (readonly [Card, string])[];
};

function readingSchema<Agency extends string, Card extends string>(
  options: CertScanOptions<Agency, Card>,
) {
  const cardValues = options.cards.map(([value]) => value) as [Card, ...Card[]];
  return z.object({
    agency: z.enum(options.agencies).nullable(),
    card: z.enum(cardValues).nullable(),
    cardNumber: z.string().nullable(),
    confidence: z.number(),
  });
}

/** The two calls a scan may make, Haiku then Sonnet, over the same image. */
export function certScanCall<Agency extends string, Card extends string>(
  image: { readonly data: string; readonly mediaType: CertScanMediaType },
  options: CertScanOptions<Agency, Card>,
  model: "quick" | "draft",
): StructuredCall<ReturnType<typeof readingSchema<Agency, Card>>> {
  const content: Anthropic.ContentBlockParam[] = [
    { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
    {
      type: "text",
      text: [
        `Agencies: ${options.agencies.join(", ")}.`,
        `Card options: ${options.cards.map(([value, label]) => `${value} (${label})`).join("; ")}.`,
      ].join("\n"),
    },
  ];
  return {
    model,
    system: CERT_SCAN_SYSTEM,
    content,
    schema: readingSchema(options),
    maxTokens: 1_000,
    confidence: (value) => value.confidence,
    // Haiku's answer comes back whatever its confidence, so `scanCard` can
    // tell "not a card" from "a card it could not read"; Sonnet's is floored.
    ...(model === "quick" ? { minConfidence: 0 } : {}),
  };
}

/** Below this a reading is not trusted (the seam's default floor). */
const SURE = 0.6;

export type CertScanFields<Agency extends string, Card extends string> = {
  agency?: Agency;
  card?: Card;
  cardNumber?: string;
};

/**
 * What a reading may put in the form: each field on its own, a number only
 * when it is one a person could have typed into the same box.
 */
export function certScanFields<Agency extends string, Card extends string>(
  value: {
    agency: Agency | null;
    card: Card | null;
    cardNumber: string | null;
    confidence: number;
  } | null,
): CertScanFields<Agency, Card> {
  // Never fill from an unsure reading, whichever call produced it.
  if (!value || !(value.confidence >= SURE)) return {};
  const fields: CertScanFields<Agency, Card> = {};
  if (value.agency) fields.agency = value.agency;
  if (value.card) fields.card = value.card;
  const number = value.cardNumber?.replace(/\s+/g, " ").trim() ?? "";
  if (
    number.length >= MIN_CARD_NUMBER_LENGTH &&
    number.length <= Math.min(MAX_CARD_NUMBER_LENGTH, 40) &&
    /\p{Nd}/u.test(number) &&
    /^[\p{L}\p{Nd} ./-]+$/u.test(number)
  ) {
    fields.cardNumber = number;
  }
  return fields;
}

/** At or below this with no field read, Haiku is saying the photo is not a card. */
const NOT_A_CARD = 0.2;

type Reading = {
  readonly agency: string | null;
  readonly card: string | null;
  readonly cardNumber: string | null;
  readonly confidence: number;
};

/**
 * Haiku first; Sonnet only when Haiku saw a card it could not read surely
 * (some field read, or a confidence above 0.2). A photo Haiku says is not a
 * card, or a Haiku call that failed or is dark, ends the scan: on the
 * anonymous sign-up page a junk image costs one call, not two (security
 * review L3, B2). `run` is the seam bound to the shop, or a test's fake; it
 * answers null for every way a call can fail.
 */
export async function scanCard<T extends Reading>(
  run: (model: "quick" | "draft") => Promise<T | null>,
): Promise<T | null> {
  const quick = await run("quick");
  if (!quick) return null;
  if (Number.isFinite(quick.confidence) && quick.confidence >= SURE) return quick;
  const sawACard =
    Boolean(quick.agency || quick.card || quick.cardNumber) || quick.confidence > NOT_A_CARD;
  return sawACard ? run("draft") : null;
}

/** An image the client posted, or null when it is not one this assist reads. */
export function parseCardImage(
  data: unknown,
  mediaType: unknown,
): { data: string; mediaType: CertScanMediaType } | null {
  if (typeof data !== "string" || typeof mediaType !== "string") return null;
  if (!(CERT_SCAN_MEDIA_TYPES as readonly string[]).includes(mediaType)) return null;
  if (data.length === 0 || data.length > CERT_SCAN_MAX_BASE64_LENGTH) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
  return { data, mediaType: mediaType as CertScanMediaType };
}

/** The e2e fixture's reading: the first offered agency and card, a plain number. */
export function certScanFixture(request: ClaudeRequest): unknown {
  const text = JSON.stringify(request.messages);
  const agency = /Agencies: ([a-z_]+)/.exec(text)?.[1] ?? null;
  const card = /Card options: ([a-z_:]+) /.exec(text)?.[1] ?? null;
  return { agency, card, cardNumber: "OW-48213", confidence: 0.92 };
}
