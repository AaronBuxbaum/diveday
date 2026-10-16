import { describe, expect, it } from "vitest";
import type { Notification } from "./kinds";
import { messageFor } from "./render";
import { fromAddressFor } from "./shop-voice";

/**
 * **The sender line and subject of the three emails layer 5 of the UX review
 * stack built or reworded** (issue #2513): the reschedule notice, the booking
 * confirmation and the Monday digest. The suite has no email capture, so a
 * pixel check is not on offer; what a diver reads in their inbox before they
 * open anything is the sender and the subject, and those are pinned here, in
 * the diver's language and in the shop's voice.
 */
const FROM = "DiveDay <notifications@ses.dive.day>";
const ids = {
  shopId: "00000000-0000-4000-8000-000000000010",
  bookingId: "00000000-0000-4000-8000-000000000001",
  personId: "00000000-0000-4000-8000-000000000003",
};
const reef = {
  shopName: "Blue Mantis",
  tripTitle: "Two-Tank Reef",
  diverName: "Nora Quinn",
  timezone: "America/New_York",
  endsAt: new Date("2026-08-01T15:00:00.000Z"),
};

const confirmation = {
  kind: "booking_confirmation",
  ...ids,
  ...reef,
  to: "nora@dive.day",
  locale: "en-US",
  startsAt: new Date("2026-08-01T12:00:00.000Z"),
} as Notification;

const rescheduled = {
  kind: "trip_rescheduled",
  ...ids,
  ...reef,
  to: "nora@dive.day",
  locale: "en-US",
  previousStartsAt: new Date("2026-08-01T12:00:00.000Z"),
  startsAt: new Date("2026-08-01T14:00:00.000Z"),
  revision: 2,
} as Notification;

const placeOnly = {
  ...rescheduled,
  startsAt: new Date("2026-08-01T12:00:00.000Z"),
  meetingPoint: { label: "Dock 4" },
} as Notification;

const monday = {
  kind: "weekly_digest",
  shopId: ids.shopId,
  personId: ids.personId,
  to: "owner@bluemantis.dive",
  locale: "en-US",
  recipientName: "Dana Reyes",
  shopName: "Blue Mantis",
  timezone: "America/New_York",
  weekOf: "2026-08-03",
  lastWeekFrom: "2026-07-27",
  lastWeekTo: "2026-08-02",
  thisWeekFrom: "2026-08-03",
  thisWeekTo: "2026-08-09",
  sections: [{ kind: "overdue", count: 2, url: "https://dive.day/shop/blue-mantis" }],
  settingsUrl: "https://dive.day/shop/blue-mantis/settings",
  turnOffUrl: "https://dive.day/digest/off/x",
} as unknown as Notification;

function sentAs(notification: Notification) {
  return { from: fromAddressFor(FROM, notification), subject: messageFor(notification).subject };
}

describe("the sender and subject of layer 5's emails", () => {
  it("sends the booking confirmation as the shop, via DiveDay", () => {
    expect(sentAs(confirmation)).toEqual({
      from: '"Blue Mantis via DiveDay" <notifications@ses.dive.day>',
      subject: "You’re on the boat: Two-Tank Reef",
    });
  });

  it("sends the reschedule notice as the shop, and names the new time in the subject", () => {
    expect(sentAs(rescheduled)).toEqual({
      from: '"Blue Mantis via DiveDay" <notifications@ses.dive.day>',
      subject: "New time for Two-Tank Reef",
    });
  });

  it("dresses the reschedule notice in the shop's name, DiveDay at the foot", () => {
    const { html } = messageFor(rescheduled);
    expect(html).toContain("Blue Mantis");
    expect(html).toContain("DiveDay");
  });

  it("names the place, not a time, when only the meeting point moved", () => {
    expect(sentAs(placeOnly)).toEqual({
      from: '"Blue Mantis via DiveDay" <notifications@ses.dive.day>',
      subject: "New meeting point for Two-Tank Reef",
    });
  });

  it("sends the Monday digest as DiveDay, since it is DiveDay writing to the shop", () => {
    expect(sentAs(monday)).toEqual({
      from: "DiveDay <notifications@ses.dive.day>",
      subject: "Your week at Blue Mantis",
    });
  });
});
