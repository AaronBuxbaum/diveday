import type { listBoats } from "@/db/boats";
import type { listDateLeadsByIds } from "@/db/lead-dates";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { adviseRequests, departureShapeFor } from "@/lib/request-advisor";
import type { BuilderRequestPlan } from "./ScheduleBuilder";

/**
 * **The plan the add panel draws for the requests a staffer carried here**
 * from `/requests`: how many divers they add up to, the boat and capacity
 * that would hold them, and — for a shop that keeps a crew schedule — how
 * many divemasters. Null when the link carried no requests.
 */
export function builderRequestPlan({
  requestRows,
  shop,
  shopBoats,
  st,
}: {
  requestRows: Awaited<ReturnType<typeof listDateLeadsByIds>>;
  shop: Parameters<typeof departureShapeFor>[0] & {
    crewScheduleEnabled: boolean;
    diversPerDivemaster: number;
  };
  shopBoats: Awaited<ReturnType<typeof listBoats>>;
  st: StaffTranslator;
}): BuilderRequestPlan | null {
  const requestAdvice = adviseRequests(
    requestRows.map((request) => ({
      id: request.id,
      divers: request.partySize,
      experienceLevel: request.experienceLevel,
      courseId: request.courseId,
    })),
    departureShapeFor(
      shop,
      shopBoats.map((b) => ({ id: b.id, name: b.name, capacity: b.capacity })),
    ),
  );
  return requestRows.length > 0
    ? {
        estimatedDivers: requestAdvice.estimatedDivers,
        suggestedCapacity: requestAdvice.suggestedCapacity,
        // A shop with no crew schedule is not told how to crew the day.
        suggestedDivemasters: shop.crewScheduleEnabled ? requestAdvice.suggestedDivemasters : 0,
        diversPerDivemaster: shop.diversPerDivemaster,
        suggestedBoatName: requestAdvice.suggestedBoat?.name ?? null,
        exceedsKnownBoats: requestAdvice.exceedsKnownBoats,
        requests: requestRows.map((request) => ({
          id: request.id,
          name: request.name ?? st("requests.anonymous"),
          subject: request.courseTitle
            ? st("requests.aboutCourse", { course: request.courseTitle })
            : st("requests.aboutDive", { interest: request.interest ?? "" }),
          divers: Math.max(1, request.partySize ?? 1),
        })),
      }
    : null;
}
