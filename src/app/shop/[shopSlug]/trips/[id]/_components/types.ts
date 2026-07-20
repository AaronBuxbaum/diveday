import type { listDiveSites } from "@/db/dive-sites";
import type { listAvailableGear } from "@/db/gear";
import type { listTripRentalGearRequests } from "@/db/gear-requests";
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
import type { listTripWaiverStatuses, listWaiverTemplates } from "@/db/waivers";

export type Trip = NonNullable<Awaited<ReturnType<typeof getTripWithBooked>>>;
export type RosterEntry = Awaited<ReturnType<typeof getTripRoster>>[number];
export type Waitlist = Awaited<ReturnType<typeof getTripWaitlist>>;
export type StaffList = Awaited<ReturnType<typeof listStaff>>;
export type TripDiveList = Awaited<ReturnType<typeof listTripDives>>;
export type DiveSiteList = Awaited<ReturnType<typeof listDiveSites>>;
export type WaiverTemplates = Awaited<ReturnType<typeof listWaiverTemplates>>;
export type WaiverRow = Awaited<ReturnType<typeof listTripWaiverStatuses>>[number];
export type ReadinessRow = Awaited<ReturnType<typeof listTripReadiness>>[number];
export type Requirement = Awaited<ReturnType<typeof getTripRequirements>>;
export type SiteRequirement = Awaited<ReturnType<typeof getTripSiteRequirement>>;
export type AvailableGear = Awaited<ReturnType<typeof listAvailableGear>>;

type RentalRow = Awaited<ReturnType<typeof listTripRentalGearRequests>>[number];
export type GearRequestByBooking = Map<string, RentalRow["request"]>;
export type GearProfileByBooking = Map<string, RentalRow["profile"]>;

export type AssignedGearItem = { assignmentId: string; label: string; type: string };
export type GearByBooking = Map<string, AssignedGearItem[]>;
export type ReadinessByBooking = Map<string, ReadinessRow>;
export type WaiverByBooking = Map<string, WaiverRow>;
