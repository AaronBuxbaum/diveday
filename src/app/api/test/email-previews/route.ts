import { NextResponse } from "next/server";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import type { Notification } from "@/lib/notifications/kinds";
import { messageFor } from "@/lib/notifications/render";

const dummyUuid = "00000000-0000-0000-0000-000000000001";

/** A departure's meeting point as a shop would type it: sample data, not copy. */
const pier = "North Pier";
const SAMPLE_MEETING_POINT = {
  label: pier,
  address: "1 Dock St, Key Largo, FL 33037",
  landmark: "Blue awning beside the fuel dock",
  parking: "Free lot behind the bait shop",
  mapQuery: `${pier}, 1 Dock St, Key Largo, FL 33037`,
};

/**
 * The shop's published phone and confirmed address, as a shop would have them
 * on file: what every shop email's sign-off reads (visual review 2026-10-24,
 * B31). Sample data, not copy.
 */
const SAMPLE_SENDER = { contactPhone: "+1 305 555 0142", contactEmail: "hello@bluemantis.example" };

const SAMPLES: Notification[] = [
  {
    kind: "booking_confirmation",
    bookingId: dummyUuid,
    shopId: dummyUuid,
    to: "diver@example.com",
    locale: DEFAULT_DIVER_LOCALE,
    diverName: "Sam Diver",
    shopName: "Blue Mantis Scuba",
    sender: SAMPLE_SENDER,
    tripTitle: "Two-Tank Coral Reef Departure",
    startsAt: new Date("2026-09-01T13:00:00Z"),
    endsAt: new Date("2026-09-01T17:00:00Z"),
    timezone: "America/New_York",
    readinessUrl: "https://diveday.example/ready/sample-token",
    packingList: ["Reef-safe sunscreen", "C-card / certification proof"],
    meetingPoint: SAMPLE_MEETING_POINT,
    calendarUrl: "https://diveday.example/s/blue-mantis/trips/trip-1/calendar",
    money: { due: "deposit", depositCents: 5_000, balanceCents: 10_000, currency: "usd" },
    freeCancellationUntil: new Date("2026-08-30T13:00:00Z"),
  },
  {
    kind: "trip_reminder_24h",
    bookingId: dummyUuid,
    shopId: dummyUuid,
    to: "diver@example.com",
    locale: DEFAULT_DIVER_LOCALE,
    shopName: "Blue Mantis Scuba",
    sender: SAMPLE_SENDER,
    tripTitle: "Two-Tank Coral Reef Departure",
    startsAt: new Date("2026-09-01T13:00:00Z"),
    timezone: "America/New_York",
    open: 1,
    dockCallMinutes: 30,
    // The diver's last boat: the fly-safe rule in hours under the dock time (H-150).
    flySafeHours: 24,
    readinessUrl: "https://diveday.example/ready/sample-token",
  },
  {
    kind: "trip_rescheduled",
    bookingId: dummyUuid,
    shopId: dummyUuid,
    to: "diver@example.com",
    locale: DEFAULT_DIVER_LOCALE,
    diverName: "Sam Diver",
    shopName: "Blue Mantis Scuba",
    sender: SAMPLE_SENDER,
    tripTitle: "Two-Tank Coral Reef Departure",
    previousStartsAt: new Date("2026-08-31T13:00:00Z"),
    startsAt: new Date("2026-09-01T13:00:00Z"),
    endsAt: new Date("2026-09-01T17:00:00Z"),
    timezone: "America/New_York",
    dockCallMinutes: 30,
    revision: 2,
    meetingPoint: SAMPLE_MEETING_POINT,
    readinessUrl: "https://diveday.example/ready/sample-token",
  },
  {
    kind: "trip_recap",
    bookingId: dummyUuid,
    shopId: dummyUuid,
    to: "diver@example.com",
    locale: DEFAULT_DIVER_LOCALE,
    shopName: "Blue Mantis Scuba",
    sender: SAMPLE_SENDER,
    tripTitle: "Two-Tank Coral Reef Departure",
    startsAt: new Date("2026-09-01T13:00:00Z"),
    timezone: "America/New_York",
    // Two dives, the last one out at 11:40 local, the shop's default 24 hours.
    flySafe: {
      from: new Date("2026-09-02T15:40:00Z"),
      hours: 24,
      basis: "repetitive",
      reason: "dives_recorded",
      anchor: "last_dive",
    },
    recapUrl: "https://diveday.example/recap/sample-token",
    unsubscribeUrl: "https://diveday.example/unsubscribe/sample-token",
  },
  {
    kind: "trip_conditions_hold",
    seatId: dummyUuid,
    tripId: dummyUuid,
    shopId: dummyUuid,
    to: "diver@example.com",
    locale: DEFAULT_DIVER_LOCALE,
    diverName: "Sam Diver",
    shopName: "Blue Mantis Scuba",
    sender: SAMPLE_SENDER,
    tripTitle: "Two-Tank Coral Reef Departure",
    startsAt: new Date("2026-09-01T13:00:00Z"),
    timezone: "America/New_York",
    tripUrl: "https://diveday.example/s/blue-mantis/trips/trip-1",
    conditionsSummary: "Watching a squall line moving through this afternoon.",
    publishedAt: new Date("2026-09-01T10:00:00Z"),
  },
  {
    kind: "waiver_request",
    waiverRecordId: dummyUuid,
    shopId: dummyUuid,
    to: "diver@example.com",
    locale: DEFAULT_DIVER_LOCALE,
    diverName: "Sam Diver",
    shopName: "Blue Mantis Scuba",
    sender: SAMPLE_SENDER,
    tripTitle: "Two-Tank Coral Reef Departure",
    completionUrl: "https://diveday.example/waivers/sign/sample-token",
    expiresAt: new Date("2026-09-01T12:00:00Z"),
    timezone: "America/New_York",
  },
  {
    kind: "password_reset_request",
    userAccountId: dummyUuid,
    tokenId: dummyUuid,
    shopId: dummyUuid,
    to: "owner@example.com",
    locale: DEFAULT_DIVER_LOCALE,
    ownerName: "Captain Alex",
    resetUrl: "https://diveday.example/reset-password/sample-token",
    expiresAt: new Date("2026-09-01T14:00:00Z"),
    timezone: "America/New_York",
  },
];

export async function GET(request: Request) {
  if (!e2eTestRouteAuthorized(request)) {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const rendered = SAMPLES.map((sample) => ({
    kind: sample.kind,
    message: messageFor(sample),
  }));

  return NextResponse.json({ previews: rendered });
}
