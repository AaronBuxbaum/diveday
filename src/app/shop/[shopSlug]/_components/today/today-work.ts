import type { HorizonReadinessEvidence } from "@/db/blockers";
import type { AppDb } from "@/db/client";
import { getTodayWork } from "@/db/today";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { Role } from "@/lib/authz";
import { type CrewScheduleShop, shopCrewTarget } from "@/lib/crew-schedule";
import type { RoleLens } from "@/lib/today";

/**
 * **The shop home's Today queue for one reader**: `getTodayWork` with the
 * page's own answers filled in, so the route reads one call. The lens decides
 * whether the queue is read as "your boats" (`personId` only for a lens); the
 * live money gate opens the owner/manager chores (task 157); the reader
 * themselves is always named, for the one row whose reading depends on who
 * they are (the unfiled incident reports, re-checked live in the database).
 */
export function readTodayWork(input: {
  db: AppDb;
  shop: { id: string; timezone: string } & CrewScheduleShop;
  shopSlug: string;
  reader: { personId: string; roles: readonly Role[] };
  lens: RoleLens;
  now: Date;
  t: StaffTranslator;
  locale: string;
  canReadShopMoney: boolean;
  evidence: HorizonReadinessEvidence;
}) {
  const { db, shop, reader } = input;
  return getTodayWork(
    db,
    shop.id,
    input.shopSlug,
    shop.timezone,
    input.now,
    input.lens ? reader.personId : undefined,
    input.t,
    input.locale,
    input.canReadShopMoney,
    input.evidence,
    shopCrewTarget(shop),
    reader.roles,
    reader.personId,
  );
}
