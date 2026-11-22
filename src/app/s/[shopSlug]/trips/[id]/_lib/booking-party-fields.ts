import { z } from "zod";
import type { DiverTranslator } from "@/i18n/messages";
import { DIVER_NAME_MAX, DIVER_PHONE_MAX, diverEmailSchema } from "@/lib/person-fields";
import { MAX_PUBLIC_PARTY_SIZE } from "@/lib/trips";
import { ERROR_MESSAGE_KEYS } from "../_components/types";

export function validateBookingParty(
  fields: Record<string, FormDataEntryValue | null> & { phone: string; promoCode: string },
  t: DiverTranslator,
) {
  const partySize = z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PUBLIC_PARTY_SIZE)
    .safeParse(fields.partySize);
  if (!partySize.success)
    return { ok: false as const, state: { error: t(ERROR_MESSAGE_KEYS.invalid) } };
  const fieldErrors: Record<string, string> = {};
  const validParty: {
    fullName: string;
    email: string;
    minorDeclared: boolean;
    declaredAge?: number;
    unnamedGuest: boolean;
  }[] = [];
  for (let index = 0; index < partySize.data; index++) {
    const fullName = String(fields[`fullName-${index}`] ?? "").trim();
    const email = String(fields[`email-${index}`] ?? "").trim();
    if (index === 0 && !fullName)
      fieldErrors[`fullName-${index}`] = t("booking.fieldErrors.nameRequired");
    if (fullName.length > DIVER_NAME_MAX)
      fieldErrors[`fullName-${index}`] = t("booking.fieldErrors.nameTooLong");
    if (index === 0 && !email) {
      fieldErrors[`email-${index}`] = t("booking.fieldErrors.emailInvalid");
    } else if (email && !diverEmailSchema.safeParse(email).success) {
      fieldErrors[`email-${index}`] = t("booking.fieldErrors.emailInvalid");
    }
    const minorDeclared = fields[`minor-${index}`] === "on";
    validParty.push({
      fullName: fullName || t("party.guestN", { number: index + 1 }),
      email: fullName ? email : "",
      unnamedGuest: index > 0 && !fullName,
      minorDeclared,
      ...(minorDeclared ? declaredAgeOf(fields[`age-${index}`]) : {}),
    });
  }
  if (fields.phone.length > DIVER_PHONE_MAX)
    fieldErrors.phone = t("booking.fieldErrors.phoneTooLong");
  if (Object.keys(fieldErrors).length > 0)
    return { ok: false as const, state: { error: t("booking.errors.checkFields"), fieldErrors } };
  return {
    ok: true as const,
    partySize: partySize.data,
    validParty,
    phone: fields.phone,
    promoCodeInput: fields.promoCode,
  };
}

/**
 * The optional age beside "Under 18": a whole number 0 to 17, else nothing. A
 * blank, a word or "40" is not an error; it books as if the box were empty,
 * because the age informs the crew and nothing here may refuse an honest diver.
 */
function declaredAgeOf(value: FormDataEntryValue | null | undefined): { declaredAge?: number } {
  const text = String(value ?? "").trim();
  if (!/^\d{1,2}$/.test(text)) return {};
  const age = Number(text);
  return age <= 17 ? { declaredAge: age } : {};
}
