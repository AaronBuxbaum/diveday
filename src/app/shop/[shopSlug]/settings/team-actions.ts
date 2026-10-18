"use server";
import { z } from "zod";
import { getDb } from "@/db/client";
import { setShopDiversPerDivemaster } from "@/db/shops";
import {
  DEFAULT_DIVERS_PER_DIVEMASTER,
  MAX_DIVERS_PER_DIVEMASTER,
  MIN_DIVERS_PER_DIVEMASTER,
} from "@/lib/divemaster-ratio";
import { formValue, readForm } from "@/lib/form-parse";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { settingsBlock } from "./action-helpers";

const crewScheduleForm = z.object({ diversPerDivemaster: formValue() });

/**
 * Saves the divemaster target the crew schedule's nudges read
 * (`src/lib/crew-schedule.ts`). The switch itself is a row of the Features page
 * (issue #2814); only a shop that plans its crew is measured against this.
 */
export async function saveCrewScheduleAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);

  const form = readForm(crewScheduleForm, formData);
  const diversPerDivemaster = parseDiversPerDivemaster(form.diversPerDivemaster);
  if (diversPerDivemaster === "invalid") {
    revalidateAndRedirect(
      settings,
      noticeUrl(settings, "crew-schedule-ratio-invalid", { form: "crewSchedule" }),
    );
    return;
  }

  await setShopDiversPerDivemaster(await getDb(), session.user.shopId, diversPerDivemaster);

  revalidateAndRedirect(
    settings,
    noticeUrl(settings, "crew-schedule-saved", { saved: "crewSchedule" }),
  );
}

/**
 * Blank falls back to the default rather than storing nothing: every
 * suggestion needs a number, and the column is not null. A typed number must
 * be a sane one — the same bounds the `shops_divers_per_divemaster_in_range`
 * check enforces underneath.
 */
function parseDiversPerDivemaster(raw: FormDataEntryValue | null): number | "invalid" {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return DEFAULT_DIVERS_PER_DIVEMASTER;
  const ratio = Number(text);
  if (
    !Number.isInteger(ratio) ||
    ratio < MIN_DIVERS_PER_DIVEMASTER ||
    ratio > MAX_DIVERS_PER_DIVEMASTER
  ) {
    return "invalid";
  }
  return ratio;
}
