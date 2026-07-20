import type { listDiveSites } from "@/db/dive-sites";
import type {
  getTripRequirements,
  getTripSiteRequirement,
  listTripReadiness,
} from "@/db/readiness";
import type {
  getTripRoster,
  getTripWaitlist,
  getTripWithBooked,
  listStaff,
  listTripDives,
} from "@/db/trips";
import type { listTripWaiverStatuses } from "@/db/waivers";
import type { RentalFit } from "@/lib/dive-prep";

export type Trip = NonNullable<Awaited<ReturnType<typeof getTripWithBooked>>>;
export type RosterEntry = Awaited<ReturnType<typeof getTripRoster>>[number];
export type Waitlist = Awaited<ReturnType<typeof getTripWaitlist>>;
export type StaffList = Awaited<ReturnType<typeof listStaff>>;
export type TripDiveList = Awaited<ReturnType<typeof listTripDives>>;
export type DiveSiteList = Awaited<ReturnType<typeof listDiveSites>>;
export type WaiverRow = Awaited<ReturnType<typeof listTripWaiverStatuses>>[number];
export type ReadinessRow = Awaited<ReturnType<typeof listTripReadiness>>[number];
export type Requirement = Awaited<ReturnType<typeof getTripRequirements>>;
export type SiteRequirement = Awaited<ReturnType<typeof getTripSiteRequirement>>;
export type RentalFitByBooking = Map<string, RentalFit | null>;

/** A diver's nitrox request, alongside whether their card actually clears it. */
export type NitroxByBooking = Map<string, { requested: boolean; approved: boolean }>;
export type ReadinessByBooking = Map<string, ReadinessRow>;
export type WaiverByBooking = Map<string, WaiverRow>;
