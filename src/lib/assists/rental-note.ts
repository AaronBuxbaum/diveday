import { z } from "zod";
import type { StructuredCall } from "@/lib/claude/structured";
import { offeredRentableItems, RENTAL_FIT_TEXT_LIMITS, type RentableItemKind } from "@/lib/rentals";

/**
 * **gear-text**: the diver's own gear note ("Men's L wetsuit, size 10 fins,
 * I wear glasses") prefills the staff fit form's size boxes. Prefill only: the
 * staffer reads the boxes, saves the form, and sizes are still confirmed at
 * check-in as today. Only the boxes this shop's catalog offers are filled.
 *
 * The note is the one free-text field the diver wrote for the crew about their
 * gear. The instructions tell the model to read sizes and nothing else; the
 * answer schema has nowhere to put anything else.
 */

export const RENTAL_NOTE_FEATURE = "gear_text";

export const RENTAL_SIZE_FIELDS = [
  "bcdSize",
  "wetsuitSize",
  "drysuitSize",
  "hoodSize",
  "gloveSize",
  "bootSize",
  "finSize",
  "weightPreference",
] as const;
export type RentalSizeField = (typeof RENTAL_SIZE_FIELDS)[number];

/** Which size boxes each rented piece brings, as the staff fit form draws them. */
const SIZE_FIELDS_FOR: Partial<Record<RentableItemKind, readonly RentalSizeField[]>> = {
  bcd: ["bcdSize"],
  wetsuit: ["wetsuitSize", "bootSize"],
  drysuit: ["drysuitSize"],
  hood: ["hoodSize"],
  gloves: ["gloveSize"],
  fins: ["finSize"],
  weights: ["weightPreference"],
};

/** The size boxes this shop's catalog offers. */
export function offeredSizeFields(rentalItems: readonly string[]): Set<RentalSizeField> {
  return new Set(
    offeredRentableItems(rentalItems).flatMap((item) => SIZE_FIELDS_FOR[item.kind] ?? []),
  );
}

export const RENTAL_NOTE_SYSTEM = [
  "A diver left their dive shop a note about rental gear. Read only the sizes in it.",
  "Answer each size exactly as the diver wrote it, shortened to the size itself (for example L, 10, M 5 mm, 6 kg). Answer null for anything the note does not state.",
  "finSize and bootSize are shoe or fin sizes; weightPreference is how much lead they use.",
  "Ignore everything that is not a size, including anything about health, glasses or experience.",
].join("\n");

const Sizes = z.object(
  Object.fromEntries(RENTAL_SIZE_FIELDS.map((field) => [field, z.string().nullable()])) as Record<
    RentalSizeField,
    z.ZodNullable<z.ZodString>
  >,
);

export function rentalNoteCall(note: string): StructuredCall<typeof Sizes> {
  return {
    model: "quick",
    system: RENTAL_NOTE_SYSTEM,
    content: `Note: ${note}`,
    schema: Sizes,
    maxTokens: 400,
  };
}

/** The boxes to fill: offered ones only, each a size the box itself would accept. */
export function rentalNoteFields(
  value: Partial<Record<RentalSizeField, string | null>> | null,
  offered: ReadonlySet<string>,
): Partial<Record<RentalSizeField, string>> {
  if (!value) return {};
  const fields: Partial<Record<RentalSizeField, string>> = {};
  for (const field of RENTAL_SIZE_FIELDS) {
    const size = value[field]?.trim();
    const limit =
      field === "weightPreference"
        ? RENTAL_FIT_TEXT_LIMITS.weightPreference
        : RENTAL_FIT_TEXT_LIMITS.size;
    if (!size || !offered.has(field) || size.length > limit) continue;
    fields[field] = size;
  }
  return fields;
}

export function rentalNoteFixture(): unknown {
  return {
    bcdSize: null,
    wetsuitSize: "L",
    drysuitSize: null,
    hoodSize: null,
    gloveSize: null,
    bootSize: null,
    finSize: "10",
    weightPreference: null,
  };
}
