"use server";
import { z } from "zod";
import { setShopDiversPerDivemaster } from "@/db/shops";
import { defineAction, land } from "@/features/server-action";
import {
  DEFAULT_DIVERS_PER_DIVEMASTER,
  MAX_DIVERS_PER_DIVEMASTER,
  MIN_DIVERS_PER_DIVEMASTER,
} from "@/lib/divemaster-ratio";
import { formValue } from "@/lib/form-parse";
import { SETTINGS_GATE } from "./action-gates";

const crewScheduleForm = z.object({ diversPerDivemaster: formValue() });

/**
 * Saves the divemaster target the crew schedule's nudges read
 * (`src/lib/crew-schedule.ts`). The switch itself is a row of the Features page
 * (issue #2814); only a shop that plans its crew is measured against this.
 */
export const saveCrewScheduleAction = defineAction({
  gate: [SETTINGS_GATE],
  input: crewScheduleForm,
  async run({ db, shopId, path }, form) {
    const settings = path("settings");
    const diversPerDivemaster = parseDiversPerDivemaster(form.diversPerDivemaster);
    if (diversPerDivemaster === "invalid") {
      return land(settings, "crew-schedule-ratio-invalid", { extra: { form: "crewSchedule" } });
    }
    await setShopDiversPerDivemaster(db, shopId, diversPerDivemaster);
    return land(settings, "crew-schedule-saved", { extra: { saved: "crewSchedule" } });
  },
});

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
