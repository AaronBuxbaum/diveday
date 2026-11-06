"use server";

import { getDb } from "@/db/client";
import { checkRateLimit, RATE_LIMITS, rateLimitKey } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import {
  type DoctorAnswersState,
  type DoctorFormState,
  revealDoctorAnswersFor,
  sendDoctorFormFor,
} from "./doctor-core";
import { partyDoorKey } from "./party-door";

/**
 * The shared per-IP bucket every waiver-link action spends from, then the
 * record from the party member's door on this phone (`partyDoorKey`).
 */
async function doorKey(token: unknown) {
  if (typeof token !== "string") return null;
  const ip = await clientIp();
  if (
    !(await checkRateLimit(rateLimitKey("waiver-token", ip), RATE_LIMITS.capabilityAction)).allowed
  )
    return "rate" as const;
  return partyDoorKey(await getDb(), token);
}

/**
 * Unlock the doctor's page's answers with the diver's date of birth, on a
 * party member's door (`revealDoctorAnswersFromReady`'s twin): the door shows
 * the page, the answers need what only the diver knows.
 */
export async function revealDoctorAnswersAction(
  token: string,
  _previous: DoctorAnswersState,
  formData: FormData,
): Promise<DoctorAnswersState> {
  const key = await doorKey(token);
  if (key === "rate") return { status: "rate" };
  if (!key) return { status: "closed" };
  return revealDoctorAnswersFor(key, formData);
}

/** Send the signed doctor's form from a party member's door (`sendDoctorFormFromReady`'s twin). */
export async function sendDoctorFormAction(
  token: string,
  _previous: DoctorFormState,
  formData: FormData,
): Promise<DoctorFormState> {
  const key = await doorKey(token);
  if (key === "rate") return { status: "rate" };
  if (!key) return { status: "closed" };
  return sendDoctorFormFor(key, formData);
}
