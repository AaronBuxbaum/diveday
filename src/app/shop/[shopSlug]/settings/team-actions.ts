"use server";
import { getDb } from "@/db/client";
import { setShopCrewSchedule } from "@/db/shops";
import {
  DEFAULT_DIVERS_PER_DIVEMASTER,
  MAX_DIVERS_PER_DIVEMASTER,
  MIN_DIVERS_PER_DIVEMASTER,
} from "@/lib/divemaster-ratio";
import { revalidateAndRedirect } from "@/lib/navigation";
import { requireStaffSession } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { settingsBlock } from "./action-helpers";

/**
 * Turns the crew schedule on or off, with the divemaster target its nudges
 * read (`src/lib/crew-schedule.ts`). The target travels with the switch
 * because it is only ever read while the switch is on.
 */
export async function saveCrewScheduleAction(formData: FormData) {
  const session = await requireStaffSession();
  const settings = shopPath(session.user.shopSlug, "settings");
  await settingsBlock(session);

  const crewScheduleEnabled = formData.get("crewScheduleEnabled") === "on";
  const diversPerDivemaster = parseDiversPerDivemaster(formData.get("diversPerDivemaster"));
  if (diversPerDivemaster === "invalid") {
    revalidateAndRedirect(
      settings,
      noticeUrl(settings, "crew-schedule-ratio-invalid", { form: "crewSchedule" }),
    );
    return;
  }

  await setShopCrewSchedule(await getDb(), session.user.shopId, {
    crewScheduleEnabled,
    diversPerDivemaster,
  });

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
