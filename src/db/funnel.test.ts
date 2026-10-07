import { describe, expect, it } from "vitest";
import { unseededTestDb } from "@/test/db";
import {
  countSetupRequestsSince,
  deleteSetupRequestsByEmail,
  deleteSetupRequestsByPhone,
  recordSetupRequest,
} from "./funnel";
import { setupRequests } from "./schema";

/** One stored request, with whatever the test is about overridden. */
function request(overrides: { email?: string; phone?: string | null; at?: Date } = {}) {
  return {
    shopName: "Reef Line Divers",
    region: "Key Largo",
    runsBoat: true,
    currentSystem: "paper" as const,
    contactName: "Ana Ruiz",
    email: overrides.email ?? "ana@reefline.example",
    phone: overrides.phone === undefined ? null : overrides.phone,
    source: "pricing" as const,
    locale: "en-US",
    at: overrides.at,
  };
}

describe("countSetupRequestsSince", () => {
  it("counts the requests at or after the instant and none before it", async () => {
    const db = await unseededTestDb();
    const since = new Date("2026-10-07T10:00:00Z");
    await recordSetupRequest(db, request({ at: new Date("2026-10-07T09:59:59Z") }));
    await recordSetupRequest(db, request({ at: since }));
    await recordSetupRequest(db, request({ at: new Date("2026-10-07T10:30:00Z") }));
    expect(await countSetupRequestsSince(db, since)).toBe(2);
  });
});

describe("erasing a person's set-up requests", () => {
  it("deletes every request sent from an address, whatever its case, and nobody else's", async () => {
    const db = await unseededTestDb();
    await recordSetupRequest(db, request());
    await recordSetupRequest(db, request());
    await recordSetupRequest(db, request({ email: "someone@else.example" }));

    expect(await deleteSetupRequestsByEmail(db, "  Ana@ReefLine.example ")).toBe(2);
    const left = await db.select({ email: setupRequests.email }).from(setupRequests);
    expect(left).toEqual([{ email: "someone@else.example" }]);
  });

  it("deletes by phone however the number was punctuated, and nobody else's", async () => {
    const db = await unseededTestDb();
    await recordSetupRequest(db, request({ phone: "+1 (305) 555-0100" }));
    await recordSetupRequest(db, request({ phone: "+1 305 555 0199" }));
    await recordSetupRequest(db, request({ phone: null }));

    expect(await deleteSetupRequestsByPhone(db, "+13055550100")).toBe(1);
    const left = await db.select({ phone: setupRequests.phone }).from(setupRequests);
    expect(left.map((row) => row.phone).sort()).toEqual(["+1 305 555 0199", null]);
  });

  it("deletes nothing for a blank address or a number with no digits", async () => {
    const db = await unseededTestDb();
    await recordSetupRequest(db, request({ phone: "+1 305 555 0100" }));
    expect(await deleteSetupRequestsByEmail(db, "   ")).toBe(0);
    expect(await deleteSetupRequestsByPhone(db, "+ ()")).toBe(0);
    expect(await db.select().from(setupRequests)).toHaveLength(1);
  });
});
