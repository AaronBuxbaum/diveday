// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestDb } from "./client";
import { getShopBySlug } from "./queries";
import { getOperationsReport } from "./reports";
import { seedDemo } from "./seed";

describe("operations report (in-memory PGlite)", () => {
  it("turns live bookings, course staffing, readiness, and rental requests into a concise queue", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");

    const report = await getOperationsReport(db, shop.id, new Date(0));

    expect(report.summary).toMatchObject({
      upcomingSessions: expect.any(Number),
      bookedDivers: expect.any(Number),
      readinessBlocked: expect.any(Number),
      courseSessions: 1,
      unstaffedCourseSessions: 0,
    });
    expect(report.sessions.find((session) => session.trip.course)?.needsInstructor).toBe(false);
  });
});
