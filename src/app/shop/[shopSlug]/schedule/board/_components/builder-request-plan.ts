import type { listDateInterestsByIds } from "@/db/interest-dates";
import type { listBoats } from "@/features/boats";
import { adviseRequests, departureShapeFor } from "@/features/request-advisor";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatMoneyScanned } from "@/lib/format";
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
  locale,
}: {
  requestRows: Awaited<ReturnType<typeof listDateInterestsByIds>>;
  shop: Parameters<typeof departureShapeFor>[0] & {
    crewScheduleEnabled: boolean;
    diversPerDivemaster: number;
  };
  shopBoats: Awaited<ReturnType<typeof listBoats>>;
  st: StaffTranslator;
  locale: string;
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
            : charterAsk(st, request),
          divers: Math.max(1, request.partySize ?? 1),
          // Shown beside the price box and nothing more: a whole-boat quote is
          // not a per-seat price, so the staffer sets the price (#3917).
          quote:
            request.charterQuoteCents !== null && request.charterQuoteCurrency
              ? st("requests.charterQuotedInBrief", {
                  amount: formatMoneyScanned(
                    request.charterQuoteCents,
                    request.charterQuoteCurrency,
                    locale,
                  ),
                })
              : null,
        })),
      }
    : null;
}

/**
 * A dive ask in the builder's brief, saying so when it asked for the whole
 * boat (loop 5, row 11): the departure built from it is private whatever the
 * box says, so the staffer reads that before they press Add.
 */
function charterAsk(
  st: StaffTranslator,
  request: { interest: string | null; charter: boolean },
): string {
  const interest = request.interest ?? "";
  return request.charter
    ? st("requests.charterAsk", { interest })
    : st("requests.aboutDive", { interest });
}
