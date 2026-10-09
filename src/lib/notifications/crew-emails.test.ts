import { describe, expect, it } from "vitest";
import { crewScheduleChangeEmail } from "./crew-emails";
import { notificationIdempotencyKey, notificationIsQueueable, notificationSchema } from "./kinds";
import { messageFor } from "./render";

const SATURDAY = new Date("2026-10-17T12:00:00Z");
const SUNDAY = new Date("2026-10-18T12:00:00Z");
const base = {
  locale: "en-US" as const,
  recipientName: "Ana Ruiz",
  shopName: "Blue <Mantis>",
  timezone: "America/New_York",
};

describe("crewScheduleChangeEmail", () => {
  it("says one change as that change, with the departure in the subject and a link to it", () => {
    const email = crewScheduleChangeEmail({
      ...base,
      changes: [
        {
          change: "assigned",
          tripTitle: "Two-Tank <Reef>",
          startsAt: SATURDAY,
          tripUrl: "https://diveday.example/shop/blue/trips/1",
        },
      ],
    });
    expect(email.subject).toMatch(/^Blue <Mantis>: You’re crewing Two-Tank <Reef>, Oct\s17/);
    expect(email.text).toContain("Hi Ana");
    expect(email.text).toContain("You’re crewing Two-Tank <Reef>");
    expect(email.text).toContain("https://diveday.example/shop/blue/trips/1");
    expect(email.html).toContain("Two-Tank &lt;Reef&gt;");
    expect(email.html).not.toContain("<Reef>");
  });

  it("lists several changes in one message, one line each", () => {
    const email = crewScheduleChangeEmail({
      ...base,
      changes: [
        {
          change: "assigned",
          tripTitle: "Morning",
          startsAt: SATURDAY,
          tripUrl: "https://x.example/1",
        },
        {
          change: "removed",
          tripTitle: "Night",
          startsAt: SATURDAY,
          tripUrl: "https://x.example/2",
        },
        {
          change: "request_approved",
          tripTitle: "Wreck",
          startsAt: SUNDAY,
          tripUrl: "https://x.example/3",
        },
        {
          change: "request_declined",
          tripTitle: "Drift",
          startsAt: SUNDAY,
          tripUrl: "https://x.example/4",
        },
      ],
    });
    expect(email.subject).toBe("Your boats at Blue <Mantis> changed");
    expect(email.text).toContain("You’re crewing Morning");
    expect(email.text).toContain("You’re no longer crewing Night");
    expect(email.text).toContain("Your request to crew Wreck");
    expect(email.text).toContain("was approved");
    expect(email.text).toContain("Your request to crew Drift");
    expect(email.text).toContain("was declined");
    expect(email.html).toContain("Blue &lt;Mantis&gt;");
  });

  it("reads in the staffer's own language", () => {
    const email = crewScheduleChangeEmail({
      ...base,
      locale: "es-ES",
      changes: [
        {
          change: "removed",
          tripTitle: "Arrecife",
          startsAt: SATURDAY,
          tripUrl: "https://x.example/1",
        },
      ],
    });
    expect(email.subject).toContain("Ya no estás en Arrecife");
    expect(email.subject).toContain("Blue <Mantis>");
  });

  it("names the role they are aboard in, in the staffer's language", () => {
    const one = (locale: "en-US" | "es-ES", change: "assigned" | "role_changed") =>
      crewScheduleChangeEmail({
        ...base,
        locale,
        changes: [
          {
            change,
            role: "divemaster",
            tripTitle: "Reef",
            startsAt: SATURDAY,
            tripUrl: "https://x.example/1",
          },
        ],
      });
    expect(one("en-US", "assigned").text).toContain("You’re crewing Reef");
    expect(one("en-US", "assigned").text).toContain("as divemaster");
    expect(one("en-US", "role_changed").text).toContain("Your role on Reef");
    expect(one("en-US", "role_changed").text).toContain("is now divemaster");
    expect(one("es-ES", "assigned").text).toContain("equipo");
    expect(one("es-ES", "assigned").text).not.toContain("tripulación");
  });

  it("tells the crew a departure was called off, and an asker the boat refused them", () => {
    const email = crewScheduleChangeEmail({
      ...base,
      changes: [
        {
          change: "called_off",
          tripTitle: "Reef",
          startsAt: SATURDAY,
          tripUrl: "https://x.example/1",
        },
        {
          change: "request_refused",
          tripTitle: "Wreck",
          startsAt: SUNDAY,
          tripUrl: "https://x.example/2",
        },
      ],
    });
    expect(email.text).toMatch(/Reef, Oct\s17, .+, was called off/);
    expect(email.text).toContain("Your request to crew Wreck");
    expect(email.text).toContain("couldn’t be added");
  });
});

describe("the crew_schedule_change kind", () => {
  const notification = {
    kind: "crew_schedule_change" as const,
    noticeId: "00000000-0000-4000-8000-000000000001",
    shopId: "00000000-0000-4000-8000-000000000002",
    to: "ana@example.com",
    ...base,
    changes: [
      {
        change: "assigned" as const,
        tripTitle: "Morning",
        startsAt: SATURDAY,
        tripUrl: "https://x.example/1",
      },
    ],
  };

  it("parses, renders, keys by its notice and is never queued for a late retry", () => {
    expect(notificationSchema.safeParse(notification).success).toBe(true);
    expect(messageFor(notification).subject).toContain("You’re crewing Morning");
    expect(notificationIdempotencyKey(notification)).toBe(
      "crew-schedule-change/00000000-0000-4000-8000-000000000001",
    );
    expect(notificationIsQueueable(notification)).toBe(false);
  });

  it("refuses a message with nothing in it", () => {
    expect(notificationSchema.safeParse({ ...notification, changes: [] }).success).toBe(false);
  });
});
