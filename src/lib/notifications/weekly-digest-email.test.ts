import { describe, expect, it } from "vitest";
import { type Notification, notificationIdempotencyKey, notificationSchema } from "./kinds";
import { messageFor } from "./render";
import { weeklyDigestQuietWeekEmail } from "./weekly-digest-email";

const BASE = {
  kind: "weekly_digest",
  shopId: "11111111-1111-4111-8111-111111111111",
  personId: "22222222-2222-4222-8222-222222222222",
  to: "owner@diveday.example",
  locale: "en-US",
  recipientName: "Dana Reyes",
  shopName: "Blue Mantis <Scuba>",
  timezone: "America/New_York",
  weekOf: "2026-10-05",
  lastWeekFrom: "2026-09-28",
  lastWeekTo: "2026-10-04",
  thisWeekFrom: "2026-10-05",
  thisWeekTo: "2026-10-11",
  sections: [
    {
      kind: "last_week",
      bookingsMade: 4,
      departures: 2,
      seatsFilled: 9,
      seats: 12,
      url: "https://diveday.example/shop/blue-mantis/reports",
    },
    {
      kind: "waivers",
      divers: 1,
      departures: 1,
      url: "https://diveday.example/shop/blue-mantis",
    },
  ],
  settingsUrl: "https://diveday.example/shop/blue-mantis/settings/email",
  turnOffUrl: "https://diveday.example/unsubscribe/abc",
} satisfies Notification;

describe("the weekly_digest notification", () => {
  it("says what last week took, the tips and what is owed, in the shop's money", () => {
    const { text } = messageFor({
      ...BASE,
      sections: [
        {
          kind: "money",
          revenueCents: 412_000,
          tipsCents: 39_500,
          owed: { orderCents: 128_300, orderCount: 6, seatCents: 9_500, seatCount: 1 },
          currency: "usd",
          url: "https://diveday.example/shop/blue-mantis/orders",
        },
      ],
    });
    expect(text).toContain("Money");
    expect(text).toContain("Last week’s departures took $4,120.00 after tax.");
    expect(text).toContain("$395.00 in tips to pass on to the crew.");
    expect(text).toContain("Owed $1,283.00 on 6 open orders.");
    expect(text).toContain("Owed $95.00 on 1 seat that sailed unpaid.");
    expect(text).toContain("Open Money: https://diveday.example/shop/blue-mantis/orders");
  });

  it("sets last week against the same week last year once there is one (item 29)", () => {
    const money = (lastYearRevenueCents: number) =>
      messageFor({
        ...BASE,
        sections: [
          {
            kind: "money",
            revenueCents: 421_000,
            lastYearRevenueCents,
            tipsCents: 0,
            owed: { orderCents: 0, orderCount: 0, seatCents: 0, seatCount: 0 },
            currency: "usd",
            url: "https://diveday.example/shop/blue-mantis/orders",
          },
        ],
      }).text;
    expect(money(358_000)).toContain(
      "Last week’s departures took $4,210.00 after tax, $630.00 more than the same week last year.",
    );
    expect(money(500_000)).toContain("$790.00 less than the same week last year.");
    expect(money(421_000)).toContain("after tax, the same as the same week last year.");
  });

  it("names this week's emptiest boat and links its deal form (item 29)", () => {
    const { text, html } = messageFor({
      ...BASE,
      sections: [
        {
          kind: "this_week",
          departures: 3,
          seatsFilled: 9,
          seats: 24,
          url: "https://diveday.example/shop/blue-mantis/schedule/board",
          weakest: {
            title: "Deep <Wreck> Charter",
            startsAt: new Date("2026-10-08T12:00:00Z"),
            booked: 1,
            capacity: 8,
            url: "https://diveday.example/shop/blue-mantis/trips/t1?view=details#last-minute-deal",
          },
        },
      ],
    });
    // The time keeps its units whole with a no-break space, so match around it.
    expect(text).toMatch(/Thursday\s8:00\sAM: Deep <Wreck> Charter has 1 of 8 booked\./u);
    expect(text).toContain(
      "booked. Send a last-minute deal: https://diveday.example/shop/blue-mantis/trips/t1?view=details#last-minute-deal",
    );
    expect(html).toContain("Deep &lt;Wreck&gt; Charter");
    expect(html).not.toContain("<Wreck>");
  });

  it("leaves out a money line with nothing to say", () => {
    const { text } = messageFor({
      ...BASE,
      sections: [
        {
          kind: "money",
          revenueCents: 0,
          tipsCents: 0,
          owed: { orderCents: 4_800, orderCount: 1, seatCents: 0, seatCount: 0 },
          currency: "usd",
          url: "https://diveday.example/shop/blue-mantis/orders",
        },
      ],
    });
    expect(text).toContain("Owed $48.00 on 1 open order.");
    expect(text).not.toContain("sailed unpaid");
    expect(text).not.toContain("took");
    expect(text).not.toContain("tips");
  });

  it("tells the owner the safety facts and the gear due for service", () => {
    const { text } = messageFor({
      ...BASE,
      sections: [
        {
          kind: "safety",
          openRollCalls: 1,
          uncrewed: 2,
          incidents: 0,
          url: "https://diveday.example/shop/blue-mantis",
        },
        { kind: "gear_service", due: 3, url: "https://diveday.example/shop/blue-mantis/gear" },
      ],
    });
    expect(text).toContain(
      "Needs attention\n1 roll call is still open.\n2 departures have no crew on them yet.",
    );
    expect(text).not.toContain("incident");
    expect(text).toContain("3 units are due for service.");
    expect(text).toContain("Open Gear: https://diveday.example/shop/blue-mantis/gear");
  });

  it("lists last week's emergency reads of a medical alert: who, whose, which departure, when (issue #2990)", () => {
    const section = {
      kind: "emergency_reads",
      total: 2,
      byReader: [
        { reader: "Kai Divemaster", count: 1 },
        { reader: "Sal Captain", count: 1 },
      ],
      reads: [
        {
          diver: "Ana <Ruiz>",
          departureTitle: "Dawn Two-Tank",
          departureStartsAt: new Date("2026-09-30T11:00:00.000Z"),
          reader: "Sal Captain",
          at: new Date("2026-09-30T12:40:00.000Z"),
        },
        {
          diver: "Ben Ito",
          departureTitle: "Night Dive",
          departureStartsAt: new Date("2026-10-02T23:00:00.000Z"),
          reader: "Kai Divemaster",
          at: new Date("2026-10-02T23:05:00.000Z"),
        },
      ],
      url: "https://diveday.example/shop/blue-mantis/divers",
    } as const;
    const parsed = notificationSchema.parse({ ...BASE, sections: [section] });
    const { text: sent, html } = messageFor(parsed);
    // Times keep their parts together with no-break spaces (`keepUnitsWhole`).
    const text = sent.replace(/[\u00a0\u202f]/g, " ");
    expect(text).toContain(
      "Medical alerts opened in an emergency\nOpened 2 times last week.\nOnce by Kai Divemaster.\nOnce by Sal Captain.\nWednesday 8:40 AM: Sal Captain opened Ana <Ruiz>’s medical alert on Dawn Two-Tank, leaving Wednesday 7:00 AM.\nFriday 7:05 PM: Kai Divemaster opened Ben Ito’s medical alert on Night Dive, leaving Friday 7:00 PM.",
    );
    expect(text).toContain("Open Divers: https://diveday.example/shop/blue-mantis/divers");
    // The diver's name is the shop's data: escaped in the html body.
    expect(html).toContain("Ana &lt;Ruiz&gt;");
    expect(html).not.toContain("Ana <Ruiz>");
  });

  it("says how many more reads there were than it lists, with a count per reader (issue #2990)", () => {
    const read = {
      diver: "Ana Ruiz",
      departureTitle: "Dawn Two-Tank",
      departureStartsAt: new Date("2026-09-30T11:00:00.000Z"),
      reader: "Sal Captain",
      at: new Date("2026-09-30T12:40:00.000Z"),
    };
    const parsed = notificationSchema.parse({
      ...BASE,
      sections: [
        {
          kind: "emergency_reads",
          total: 61,
          byReader: [
            { reader: "Sal Captain", count: 60 },
            { reader: "Dana Reyes", count: 1 },
          ],
          reads: Array.from({ length: 50 }, () => read),
          url: "https://diveday.example/shop/blue-mantis/divers",
        },
      ],
    });
    const text = messageFor(parsed).text.replace(/[\u00a0\u202f]/g, " ");
    expect(text).toContain(
      "Opened 61 times last week.\n60 times by Sal Captain.\nOnce by Dana Reyes.",
    );
    expect(text.match(/opened Ana Ruiz’s medical alert/g)).toHaveLength(50);
    expect(text).toContain("And 11 more, each on the diver’s record.");
  });

  it("names a stand-in for a blank diver, reader or departure, and still sends (issue #2990)", () => {
    const parsed = notificationSchema.parse({
      ...BASE,
      sections: [
        {
          kind: "emergency_reads",
          total: 1,
          byReader: [{ reader: null, count: 1 }],
          reads: [
            {
              diver: null,
              departureTitle: null,
              departureStartsAt: new Date("2026-09-30T11:00:00.000Z"),
              reader: null,
              at: new Date("2026-09-30T12:40:00.000Z"),
            },
          ],
          url: "https://diveday.example/shop/blue-mantis/divers",
        },
      ],
    });
    const text = messageFor(parsed).text.replace(/[\u00a0\u202f]/g, " ");
    expect(text).toContain("Once by a staffer.");
    expect(text).toContain(
      "Wednesday 8:40 AM: a staffer opened a diver’s medical alert on a departure, leaving Wednesday 7:00 AM.",
    );
    expect(text).not.toContain("more, each");
  });

  it("names no emergency read in a week that had none", () => {
    const { text } = messageFor(BASE);
    expect(text).not.toContain("emergency");
    expect(() =>
      notificationSchema.parse({
        ...BASE,
        sections: [
          {
            kind: "emergency_reads",
            total: 0,
            byReader: [],
            reads: [],
            url: "https://diveday.example/x",
          },
        ],
      }),
    ).toThrow();
  });

  it("validates, and keys one email per person per week", () => {
    const parsed = notificationSchema.parse(BASE);
    expect(notificationIdempotencyKey(parsed)).toBe(
      "weekly-digest/22222222-2222-4222-8222-222222222222/2026-10-05",
    );
  });

  it("refuses an email with nothing in it", () => {
    expect(notificationSchema.safeParse({ ...BASE, sections: [] }).success).toBe(false);
  });

  it("renders only the sections it was given, each with its link", () => {
    const { subject, text, html } = messageFor(BASE);
    expect(subject).toBe("Your week at Blue Mantis <Scuba>");
    expect(text).toContain("4 new bookings.");
    expect(text).toContain("2 departures sailed with 9 of 12 seats filled (75%).");
    expect(text).toContain("1 diver still needs a signed waiver, across 1 departure this week.");
    expect(text).toContain("Open Reports: https://diveday.example/shop/blue-mantis/reports");
    expect(text).not.toContain("Reviews");
    expect(html).toContain('href="https://diveday.example/shop/blue-mantis/reports"');
  });

  it("names the zone the weeks are cut in", () => {
    expect(messageFor(BASE).text).toContain("Weeks run Monday to Sunday, Eastern Daylight Time.");
  });

  it("carries the way out and the settings page, and no commercial postal footer", () => {
    const { text, html } = messageFor({
      ...BASE,
      sender: { postalAddress: "1 Ocean Dr, Key Largo, FL" },
    });
    expect(text).toContain("Stop these emails: https://diveday.example/unsubscribe/abc");
    expect(text).toContain(
      "Email settings: https://diveday.example/shop/blue-mantis/settings/email",
    );
    expect(html).not.toContain("Key Largo");
  });

  it("escapes the shop's own words in the html body", () => {
    const { html } = messageFor(BASE);
    expect(html).toContain("Blue Mantis &lt;Scuba&gt;");
    expect(html).not.toContain("Blue Mantis <Scuba>");
  });

  it("writes Spanish to a Spanish-speaking recipient", () => {
    const { subject, text } = messageFor({ ...BASE, locale: "es-ES" });
    expect(subject).toBe("Tu semana en Blue Mantis <Scuba>");
    expect(text).toContain("4 reservas nuevas.");
    expect(text).toContain("Las semanas van de lunes a domingo");
  });

  it("drops the sailing line from a week that only took bookings", () => {
    const { text } = messageFor({
      ...BASE,
      sections: [
        {
          kind: "last_week",
          bookingsMade: 1,
          departures: 0,
          seatsFilled: 0,
          seats: 0,
          url: "https://diveday.example/shop/blue-mantis/reports",
        },
      ],
    });
    expect(text).toContain("1 new booking.");
    expect(text).not.toContain("sailed");
  });
});

describe("weeklyDigestQuietWeekEmail", () => {
  it("says no email goes out", () => {
    expect(weeklyDigestQuietWeekEmail({ locale: "en-US", shopName: "Blue Mantis" }).text).toContain(
      "no email goes out this Monday",
    );
  });
});

describe("report preparation and attention order", () => {
  it("promotes an open roll call before assist prose while keeping each assist link with its section", () => {
    const { html, text } = messageFor({
      ...BASE,
      preparedAt: "2026-10-05T04:05:00.000Z",
      sections: [
        ...BASE.sections,
        {
          kind: "safety",
          openRollCalls: 2,
          uncrewed: 1,
          incidents: 0,
          url: "https://diveday.example/shop/blue-mantis/today",
        },
      ],
      read: [
        { section: "last_week", text: "Weekly booking context." },
        { section: "safety", text: "Open roll call context." },
      ],
    });
    expect(text.indexOf("Needs attention")).toBeLessThan(text.indexOf("Weekly booking context."));
    expect(html.indexOf("Needs attention")).toBeLessThan(html.indexOf("Weekly booking context."));
    expect(html).toContain(
      'Weekly booking context. <a href="https://diveday.example/shop/blue-mantis/reports">',
    );
    expect(html).toContain(
      'Open roll call context. <a href="https://diveday.example/shop/blue-mantis/today">',
    );
    expect(text).toContain("Prepared");
    expect(text).toContain("12:05");
    expect(html).toContain("Prepared");
  });
  it("does not invent an attention alert or preparation instant for an older queued payload", () => {
    const { html, text } = messageFor({
      ...BASE,
      sections: [
        ...BASE.sections,
        {
          kind: "safety",
          openRollCalls: 0,
          uncrewed: 1,
          incidents: 0,
          url: "https://diveday.example/shop/blue-mantis/today",
        },
      ],
    });
    expect(text).not.toContain("Needs attention");
    expect(html).not.toContain("Needs attention");
    expect(text).not.toContain("Prepared");
    expect(notificationSchema.safeParse(BASE).success).toBe(true);
    expect(notificationSchema.safeParse({ ...BASE, preparedAt: "yesterday" }).success).toBe(false);
  });
});
