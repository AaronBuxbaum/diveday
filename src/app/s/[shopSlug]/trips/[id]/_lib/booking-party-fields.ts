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
    validParty.push({
      fullName: fullName || t("party.guestN", { number: index + 1 }),
      email: fullName ? email : "",
      unnamedGuest: index > 0 && !fullName,
      minorDeclared: fields[`minor-${index}`] === "on",
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
