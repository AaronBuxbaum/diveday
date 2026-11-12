import { expect, it } from "vitest";
import { headCountView } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/head-count-view";
import { readManifestPage } from "@/app/shop/[shopSlug]/trips/[id]/manifest/_components/manifest-reads";
import { getTripManifest } from "@/db/manifests";
import { nowDate } from "@/lib/clock";
import { manifestPhysicalCounts } from "@/lib/manifests";
import { fileScopedShopContext } from "../db";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "../staff-session";
import { seedDualRoleManifest } from "./dual-role-manifest";
import { resolveFacts } from "./index";

const ctx = fileScopedShopContext();
it("is private-only and preserves an explicit missing passenger beside their aboard crew role", async () => {
  const resolution = resolveFacts(["dualRoleManifest"]);
  expect(resolution.ok && resolution.facts[0]?.privateOnly).toBe(true);
  const { db, shop } = ctx;
  const actor = await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL);
  const fact = await seedDualRoleManifest(db, shop, nowDate());
  const departure = await getTripManifest(db, shop.id, fact.tripId, "departure");
  if (!departure) throw new Error("dual-role departure missing");
  expect(manifestPhysicalCounts(departure)).toEqual({ booked: 6, boarded: 6 });
  expect(
    headCountView({ manifest: departure, checkpoint: "departure", isDeparture: true })
      .overTotalPersons,
  ).toBeNull();
  const assembled = await readManifestPage(db, shop, fact.tripId, actor);
  expect(
    assembled.boatSafety?.notices.filter((notice) => notice.code === "over_total_persons"),
  ).toEqual([]);
  const conflict = await getTripManifest(db, shop.id, fact.tripId, "after_dive_1");
  expect(conflict?.divers.find((row) => row.bookingId === fact.bookingId)?.rollCall?.state).toBe(
    "not_boarded",
  );
  expect(conflict?.crew.find((row) => row.id === fact.personId)?.rollCall?.state).toBe("boarded");
  expect(conflict?.completeness.complete).toBe(false);
});
