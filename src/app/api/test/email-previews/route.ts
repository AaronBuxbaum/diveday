import { NextResponse } from "next/server";
import { DEFAULT_DIVER_LOCALE } from "@/i18n/settings";
import { e2eTestRouteAuthorized } from "@/lib/e2e-test-routes";
import type { Notification } from "@/lib/notifications/kinds";
import { messageFor } from "@/lib/notifications/render";

const dummyUuid = "00000000-0000-0000-0000-000000000001";

const SAMPLES: Notification[] = [
  {
    kind: "booking_confirmation",
    bookingId: dummyUuid,
    shopId: dummyUuid,
    to: "diver@example.com",
    locale: DEFAULT_DIVER_LOCALE,
    diverName: "Sam Diver",
    shopName: "Blue Mantis Scuba",
    tripTitle: "Two-Tank Coral Reef Departure",
    startsAt: new Date("2026-09-01T13:00:00Z"),
    endsAt: new Date("2026-09-01T17:00:00Z"),
    timezone: "America/New_York",
    readinessUrl: "https://diveday.example/ready/sample-token",
    packingList: ["Reef-safe sunscreen", "C-card / certification proof"],
  },
  {
    kind: "trip_reminder_24h",
    bookingId: dummyUuid,
    shopId: dummyUuid,
    to: "diver@example.com",
    locale: DEFAULT_DIVER_LOCALE,
    diverName: "Sam Diver",
    shopName: "Blue Mantis Scuba",
    tripTitle: "Two-Tank Coral Reef Departure",
    startsAt: new Date("2026-09-01T13:00:00Z"),
    endsAt: new Date("2026-09-01T17:00:00Z"),
    timezone: "America/New_York",
    readinessUrl: "https://diveday.example/ready/sample-token",
    brief: {
      forecast: "Calm 1ft seas, 82°F water temperature",
      bring: ["Towel", "Certification card", "Sunglasses"],
      whoToText: "+1 305 555 0199",
    },
  },
  {
    kind: "trip_conditions_hold",
    tripId: dummyUuid,
    shopId: dummyUuid,
    to: "diver@example.com",
    locale: DEFAULT_DIVER_LOCALE,
    diverName: "Sam Diver",
    shopName: "Blue Mantis Scuba",
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
