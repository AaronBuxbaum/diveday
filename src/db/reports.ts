import type { AppDb } from "./client";
import { listTripRentalGearRequests } from "./gear-requests";
import { getTripCrewIds, listStaff, upcomingTripsWithCounts } from "./queries";
import { listTripReadiness } from "./readiness";

export type OperationsReport = {
  summary: {
    upcomingSessions: number;
    bookedDivers: number;
    readinessBlocked: number;
    rentalRequests: number;
    courseSessions: number;
    unstaffedCourseSessions: number;
  };
  sessions: {
    trip: Awaited<ReturnType<typeof upcomingTripsWithCounts>>[number];
    readinessBlocked: number;
    rentalRequests: number;
    needsInstructor: boolean;
  }[];
};

/**
 * A deliberately compact operations report. It speaks in existing, auditable
 * source-of-truth models instead of inventing a separate analytics store, and
 * keeps the reporting slice useful before a data warehouse is warranted.
 */
export async function getOperationsReport(
  db: AppDb,
  shopId: string,
  now: Date = new Date(),
): Promise<OperationsReport> {
  const [sessions, staff] = await Promise.all([
    upcomingTripsWithCounts(db, shopId, now),
    listStaff(db, shopId),
  ]);
  const reports = await Promise.all(
    sessions.slice(0, 30).map(async (trip) => {
      const [readiness, requests, crewIds] = await Promise.all([
        listTripReadiness(db, shopId, trip.id),
        listTripRentalGearRequests(db, shopId, trip.id),
        getTripCrewIds(db, trip.id),
      ]);
      const hasInstructor = staff.some(
        (entry) => crewIds.includes(entry.person.id) && entry.roles.includes("instructor"),
      );
      return {
        trip,
        readinessBlocked: readiness.filter((row) => row.readiness.status === "blocked").length,
        rentalRequests: requests.filter((row) => row.request).length,
        needsInstructor: Boolean(trip.course?.requiresInstructor && !hasInstructor),
      };
    }),
  );

  return {
    summary: {
      upcomingSessions: sessions.length,
      bookedDivers: sessions.reduce((total, session) => total + session.booked, 0),
      readinessBlocked: reports.reduce((total, report) => total + report.readinessBlocked, 0),
      rentalRequests: reports.reduce((total, report) => total + report.rentalRequests, 0),
      courseSessions: sessions.filter((session) => session.course).length,
      unstaffedCourseSessions: reports.filter((report) => report.needsInstructor).length,
    },
    sessions: reports,
  };
}
