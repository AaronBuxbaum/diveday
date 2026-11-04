import { describe, expect, it } from "vitest";
import { callTripBlowout, getTripBlowout } from "@/db/blowouts";
import { createTrip } from "@/db/trips";
import { reinstateTripClearingMinimum } from "@/db/trips-minimum";
import { staffTranslator } from "@/i18n/staff-messages";
import { HOUR_MS, nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { fakeEmail } from "@/test/fakes";
import { SEEDED_OWNER_EMAIL, seededStaffPersonId } from "@/test/staff-session";
import { blowoutTitleKey } from "./title";

const ctx = fileScopedShopContext();

describe("the cancellation record heading and metadata title", () => {
  it("names the retained weather record without declaring a reinstated departure canceled", async () => {
    const { db, shop } = ctx;
    const now = nowDate();
    const trip = await createTrip(db, {
      shopId: shop.id,
      title: "Weather improves",
      startsAt: new Date(now.getTime() + 24 * HOUR_MS),
      endsAt: new Date(now.getTime() + 28 * HOUR_MS),
      capacity: 8,
    });
    if (!trip) throw new Error("test departure missing");
    const called = await callTripBlowout(db, {
      shopId: shop.id,
      tripId: trip.id,
      calledByPersonId: await seededStaffPersonId(db, shop.id, SEEDED_OWNER_EMAIL),
      provider: fakeEmail().provider,
    });
    expect(called.ok).toBe(true);
    const reinstated = await reinstateTripClearingMinimum(db, shop.id, trip.id);
    expect(reinstated?.status).toBe("scheduled");
    const record = await getTripBlowout(db, shop.id, trip.id);
    expect(record?.cause).toBe("weather");
    if (!record) throw new Error("retained record missing");

    expect(staffTranslator("en-US")(blowoutTitleKey(record))).toBe("Cancellation record");
    expect(staffTranslator("es-ES")(blowoutTitleKey(record))).toBe("Registro de cancelación");
    expect(staffTranslator("en-US")("trips.detail.viewBlowout", { cause: record.cause })).toBe(
      "View cancellation record",
    );
    expect(staffTranslator("es-ES")("trips.detail.viewBlowout", { cause: record.cause })).toBe(
      "Ver el registro de cancelación",
    );
    // A run's cancellation retains its existing cause-specific wording.
    expect(staffTranslator("en-US")(blowoutTitleKey({ ...record, cause: "run_ended" }))).toBe(
      "Canceled with its run",
    );
    expect(staffTranslator("es-ES")(blowoutTitleKey({ ...record, cause: "run_ended" }))).toBe(
      "Cancelada con su serie",
    );
  });

  it("keeps the pre-call confirmation distinct from the historical record", () => {
    expect(blowoutTitleKey(null)).toBe("blowout.confirm.title");
  });
});
