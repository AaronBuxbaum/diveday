import type { StaffMessageKey } from "@/i18n/staff-messages";
import { DAY_MS } from "./clock";

/**
 * Nothing you typed is lost (ADR 20260906-before-you-ask, decision 3).
 *
 * A staff form keeps a draft per person and per form for a day, written on
 * blur and on navigation, and applied when the form is next opened anywhere —
 * the desk's half-filled booking picks up on the phone. This module is the
 * framework-free half: which forms draft, how long a draft lives, and which
 * fields may never be in one.
 */
export const FORM_DRAFT_KINDS = ["add_departure", "new_diver", "took_a_call"] as const;
export type FormDraftKind = (typeof FORM_DRAFT_KINDS)[number];

/**
 * Where a kept draft is picked back up, below `/shop/<shopSlug>`, and what
 * Today's "unfinished" row calls it.
 *
 * **Exhaustive records rather than the ternaries they replace.** Today's spine
 * resolved both of these with `form === "add_departure" ? … : …`, which is
 * correct for exactly two kinds and silently wrong for a third: a `took_a_call`
 * draft would have offered "Resume" on a link to the new-diver form, carrying a
 * caller's answers into somebody else's page. A record keyed by the union is a
 * compile error instead.
 *
 * Keys, never words — `src/lib` picks neither (ADR
 * 20260731-domain-layer-copy-leaks); the spine resolves them against the staff
 * bundle.
 */
export const FORM_DRAFT_RESUME_SUFFIX: Record<FormDraftKind, string> = {
  add_departure: "/schedule/board?add=1",
  new_diver: "/divers/new",
  took_a_call: "/calls",
};

export const FORM_DRAFT_LABEL_KEYS: Record<FormDraftKind, StaffMessageKey> = {
  add_departure: "today.unfinished.addDeparture",
  new_diver: "today.unfinished.newDiver",
  took_a_call: "today.unfinished.tookACall",
};

export function isFormDraftKind(value: unknown): value is FormDraftKind {
  return typeof value === "string" && (FORM_DRAFT_KINDS as readonly string[]).includes(value);
}

/** A draft older than this is stale enough to be a surprise, and is dropped. */
export const FORM_DRAFT_TTL_MS = DAY_MS;

/** How long a draft's field text may run; anything longer is not a form field. */
export const FORM_DRAFT_FIELD_MAX = 4_000;
export const FORM_DRAFT_FIELDS_MAX = 80;

/**
 * Fields a draft never holds, by name. Payment details and medical answers are
 * the ADR's two named exclusions; secrets and tokens join them because a draft
 * is a plain row anyone with the shop's database can read.
 */
const NEVER_DRAFTED =
  /card|cvc|cvv|expir|iban|routing|account[_-]?number|medical|questionnaire|password|token|secret|otp/i;

/** The names a form uses for its own machinery rather than its content. */
const MACHINERY = /^(holdKind|surface|csrf|_)/;

export function isDraftableField(name: string): boolean {
  return name.length > 0 && !NEVER_DRAFTED.test(name) && !MACHINERY.test(name);
}

export type DraftFields = Record<string, string>;

/**
 * The draftable subset of a form's fields: named, text-valued, not on the
 * never-list, and bounded. Multi-valued fields (a checkbox group) keep every
 * value under one name, space-joined — the shape `applyFormFields` splits on
 * the way back in, which is why a group's values are ids and never prose.
 */
export function draftableFields(entries: Iterable<[string, string]>): DraftFields {
  const out: DraftFields = {};
  let count = 0;
  for (const [name, value] of entries) {
    if (!isDraftableField(name)) continue;
    if (value.length > FORM_DRAFT_FIELD_MAX) continue;
    if (name in out) {
      out[name] = `${out[name]} ${value}`;
      continue;
    }
    if (count >= FORM_DRAFT_FIELDS_MAX) break;
    out[name] = value;
    count += 1;
  }
  return out;
}

/** Whether a draft has anything in it worth keeping — a single typed character is. */
export function draftHasContent(fields: DraftFields): boolean {
  return Object.values(fields).some((value) => value.trim().length > 0);
}

export function draftIsFresh(savedAt: Date, now: Date, ttlMs = FORM_DRAFT_TTL_MS): boolean {
  return now.getTime() - savedAt.getTime() < ttlMs;
}
