import { describe, expect, it } from "vitest";
import type { ZodObject, ZodType } from "zod";

import {
  NOTIFICATION_TRIP_TITLE_MAX,
  type Notification,
  notificationSchema,
  notificationSubjectEmail,
  notificationSubjectPhone,
} from "./kinds";

/** A zod type with its optional/nullable wrappers taken off. */
function unwrap(type: ZodType): { type?: string; format?: string } {
  let def = (type as unknown as { def: Record<string, unknown> }).def;
  while (def?.innerType) def = (def.innerType as { def: Record<string, unknown> }).def;
  return def as { type?: string; format?: string };
}

/**
 * Every branch of the discriminated union, by its `kind`, with the fields that
 * carry a way to reach a person.
 *
 * **An address is found by its schema, not by its name.** `z.email()` sets
 * `format: "email"` on the def, so a future `replyTo`, `mailbox` or
 * `contactAddress` is caught by the same test that caught `inquirerEmail` —
 * which a `/email$/` pattern would have walked straight past. A **phone** has
 * no structural signature (it is a trimmed, length-bounded string like a dozen
 * others), so it is matched by name and that is the one convention this guard
 * depends on.
 *
 * Reached through the parsed schema rather than by importing the twenty-three
 * private consts: the union is what the rest of the app sees, and a branch
 * somebody forgets to add to it is not a kind at all.
 */
function branches(): { kind: string; email: string[]; phone: string[] }[] {
  // `notificationSchema` is `discriminatedUnion(...).and(...)`, so the union
  // itself is the intersection's left side. `sender.replyTo` on the right side
  // is deliberately out of scope: it is a shop's own published business
  // address, resolved server-side, never a person an erasure is about.
  const union = (
    notificationSchema as unknown as { def: { left: { def: { options: ZodType[] } } } }
  ).def.left.def.options;
  return union.map((option) => {
    const shape = (option as ZodObject).def.shape as Record<string, ZodType>;
    const kind = (shape.kind as unknown as { def: { values: string[] } }).def.values[0] ?? "";
    const entries = Object.entries(shape);
    return {
      kind,
      email: entries.filter(([, type]) => unwrap(type).format === "email").map(([name]) => name),
      phone: entries
        .filter(([name, type]) => /phone/i.test(name) && unwrap(type).type === "string")
        .map(([name]) => name),
    };
  });
}

/**
 * **The guard that keeps the two subject handles honest.**
 *
 * Legal erasure can only match handles lifted into real columns — the payload
 * is sealed, so no `->>` reaches inside it (issue #1297). `to` is one handle;
 * `subject_email` and `subject_phone` are the others, populated from
 * `notificationSubjectEmail` and `notificationSubjectPhone`, which are two
 * `switch` statements somebody has to remember to extend.
 *
 * This is what remembers for them. Each kind's sample below gives every
 * non-recipient contact field a *distinct* value, and the test asserts every
 * one of those values comes back out of one of the two functions. So it fails
 * not only when a new kind carries an unsurfaced handle — the bug it was
 * written for, `course_inquiry`'s `inquirerEmail` (issue #1298) — but also
 * when a kind already covered *grows a second one*, which a "returns something
 * truthy" assertion would have waved through.
 */
describe("every handle a notification carries is reachable by the erasure sweep", () => {
  /**
   * One sample per kind that carries a non-recipient handle, each field a
   * distinct value so the assertion below can tell which one came back.
   */
  const SUBJECT_SAMPLES: Record<string, Notification> = {
    course_inquiry: {
      kind: "course_inquiry",
      courseInquiryId: "00000000-0000-4000-8000-000000000001",
      shopId: "00000000-0000-4000-8000-000000000002",
      to: "desk@shop.invalid",
      locale: "en-US",
      shopName: "Blue Mantis Divers",
      courseTitle: "Open Water",
      inquirerEmail: "diver@example.invalid",
      inquirerPhone: "+1 305 555 0134",
    } as Notification,
    // Addressed to the guardian and carrying no address for the minor at all:
    // this kind is never queued (`notificationIsQueueable`), so there is no row
    // for an erasure sweep to reach and nothing to lift into a column for it
    // (issue #1453).
    guardian_release_copy: {
      kind: "guardian_release_copy",
      waiverRecordId: "00000000-0000-4000-8000-000000000007",
      shopId: "00000000-0000-4000-8000-000000000008",
      to: "parent@example.invalid",
      locale: "en-US",
      guardianName: "Jordan Fischer",
      diverName: "Lena Fischer",
      shopName: "Blue Mantis Divers",
      releaseTitle: "Liability Release",
      releaseVersion: 3,
      signedAt: new Date("2026-08-01T13:00:00.000Z"),
      timezone: "America/New_York",
    } as Notification,
    new_account_alert: {
      kind: "new_account_alert",
      userAccountId: "00000000-0000-4000-8000-000000000003",
      shopId: "00000000-0000-4000-8000-000000000004",
      to: "founder@diveday.invalid",
      ownerName: "Dana Reyes",
      ownerEmail: "dana@shop.invalid",
      shopName: "Blue Mantis Divers",
      shopSlug: "blue-mantis",
    } as Notification,
    // Never queued in practice — it rides `notify()` with no shop — but its
    // handles are reachable all the same, so a future queued path is covered.
    setup_request_alert: {
      kind: "setup_request_alert",
      setupRequestId: "00000000-0000-4000-8000-000000000009",
      to: "onboarding@diveday.invalid",
      shopName: "Reef Line Divers",
      region: "Key Largo",
      runsBoat: true,
      currentSystem: "paper",
      contactName: "Ana Ruiz",
      contactEmail: "ana@shop.invalid",
      contactPhone: "+1 305 555 0100",
      source: "pricing",
      requestLocale: "en-US",
    } as Notification,
    // The bookkeeper's address, in a notice to an owner (item 35). Never
    // queued, but reachable all the same.
    bookkeeper_notice: {
      kind: "bookkeeper_notice",
      shopId: "00000000-0000-4000-8000-000000000001",
      personId: "00000000-0000-4000-8000-000000000002",
      to: "owner@shop.invalid",
      locale: "en-US",
      recipientName: "Dana Reyes",
      shopName: "Reef Line Divers",
      reportsUrl: "https://diveday.invalid/shop/reef-line/reports#bookkeeper",
      event: "sent",
      email: "books@ledger.invalid",
      month: "2026-09",
      at: new Date("2026-10-02T13:09:00Z"),
    } as Notification,
  };

  it("finds every kind in the union", () => {
    const kinds = branches().map((branch) => branch.kind);
    // A sanity check on the introspection itself: if the shape of
    // `notificationSchema` ever changes under this file, the sweep below would
    // pass vacuously over an empty list, which is the failure mode a guard
    // must never have.
    expect(kinds.length).toBeGreaterThan(20);
    expect(kinds).toContain("course_inquiry");
    expect(kinds).toContain("booking_confirmation");
  });

  it("recognizes an address by its schema rather than its name", () => {
    // The half that stops a future `replyTo` or `mailbox` slipping past. If
    // this ever reads zero, `unwrap` has lost track of zod's shape and every
    // assertion below is vacuous.
    const inquiry = branches().find((branch) => branch.kind === "course_inquiry");
    expect(inquiry?.email).toEqual(["to", "inquirerEmail"]);
    expect(inquiry?.phone).toEqual(["inquirerPhone"]);
  });

  /**
   * **The shop's own published number, not a person's** — out of scope for
   * the same reason `sender.replyTo` is. A date request's acknowledgment tells
   * the diver how to reach the shop sooner (third UX review, item 13); the
   * number is `shops.contact_phone`, resolved server-side, and erasing a diver
   * never reaches it. Listed by kind and field, so a second phone on the same
   * kind is still caught.
   */
  const SHOP_OWNED_NUMBERS: Record<string, readonly string[]> = {
    course_inquiry_received: ["shopPhone"],
    // The stale-roll-call alert's shore copy says whom to call first: the
    // shop's own `contact_phone` (H-118). Never queued, either.
    roll_call_stale_shore: ["shopPhone"],
  };

  it.each(branches())("$kind surfaces every handle it carries", ({ kind, email, phone }) => {
    const shopOwned = SHOP_OWNED_NUMBERS[kind] ?? [];
    const extra = [
      ...email.filter((field) => field !== "to"),
      ...phone.filter((field) => !shopOwned.includes(field)),
    ];
    if (extra.length === 0) return;

    const sample = SUBJECT_SAMPLES[kind];
    expect(
      sample,
      `${kind} declares ${extra.join(", ")} beside \`to\`, so the person it is *about* is not the ` +
        "person it is addressed to. Add a case to `notificationSubjectEmail` or " +
        "`notificationSubjectPhone` (kinds.ts) so legal erasure can reach a queued row for them, " +
        "and a sample here.",
    ).toBeDefined();
    if (!sample) return;

    const surfaced = [notificationSubjectEmail(sample), notificationSubjectPhone(sample)];
    for (const field of extra) {
      const value = (sample as unknown as Record<string, unknown>)[field];
      expect(
        surfaced,
        `${kind}.${field} is a way to reach a person and no subject handle returns it, so an ` +
          "erased diver’s queued row keeps it.",
      ).toContain(value);
    }
  });

  it("says nothing for a kind whose subject is its recipient", () => {
    const passwordChanged = {
      kind: "password_changed",
      userAccountId: "00000000-0000-4000-8000-000000000005",
      shopId: "00000000-0000-4000-8000-000000000006",
      to: "dana@shop.invalid",
      locale: "en-US",
      ownerName: "Dana Reyes",
      changedAt: new Date("2026-09-04T00:00:00Z"),
    } as Notification;
    expect(notificationSubjectEmail(passwordChanged)).toBeNull();
    expect(notificationSubjectPhone(passwordChanged)).toBeNull();
  });

  it("hands back null rather than undefined when an optional handle is absent", () => {
    // Both columns are nullable and the writer inserts these values directly,
    // so `undefined` would silently become a Drizzle default rather than a
    // null. A phone-only lead is the case that matters: it has no address at
    // all, which is the hole the first version of this fix shipped.
    const phoneOnly = { ...SUBJECT_SAMPLES.course_inquiry } as Record<string, unknown>;
    delete phoneOnly.inquirerEmail;
    expect(notificationSubjectEmail(phoneOnly as Notification)).toBeNull();
    expect(notificationSubjectPhone(phoneOnly as Notification)).toBe("+1 305 555 0134");
  });
});

describe("setup_request_alert", () => {
  const alert = {
    kind: "setup_request_alert",
    setupRequestId: "00000000-0000-4000-8000-000000000009",
    to: "onboarding@diveday.invalid",
    shopName: "Reef Line Divers",
    region: "Key Largo",
    runsBoat: true,
    currentSystem: "paper",
    contactName: "Ana Ruiz",
    contactEmail: "ana@shop.invalid",
    source: "pricing",
    requestLocale: "en-US",
  };

  it("takes a request the form accepted", () => {
    expect(notificationSchema.safeParse(alert).success).toBe(true);
  });

  it("refuses a line break or a bidi override in an answer, whoever the caller", () => {
    for (const shopName of ["Reef\r\nBcc: x@example.com", "Reef‮Line", "Reef Line"]) {
      expect(notificationSchema.safeParse({ ...alert, shopName }).success).toBe(false);
    }
  });
});

/**
 * **A long trip title shortens a notification, it never fails one** (issue
 * #2603). `trips.title` is unbounded text, so every kind that carries a
 * `tripTitle` shares one schema that clips it. Found by walking the union, so
 * a kind added later with its own `max(200)` is caught here.
 */
describe("every kind's tripTitle shortens a long title instead of rejecting it", () => {
  /** Every `tripTitle` schema in the union, with the kind it belongs to, nested ones included. */
  function tripTitleFields(): { where: string; schema: ZodType }[] {
    const union = (
      notificationSchema as unknown as { def: { left: { def: { options: ZodType[] } } } }
    ).def.left.def.options;
    const found: { where: string; schema: ZodType }[] = [];
    const walk = (where: string, shape: Record<string, ZodType>) => {
      for (const [name, field] of Object.entries(shape)) {
        if (name === "tripTitle") found.push({ where, schema: field });
        let def = (field as unknown as { def: Record<string, unknown> }).def;
        while (def?.innerType) def = (def.innerType as { def: Record<string, unknown> }).def;
        const element = def?.element as { def?: { shape?: Record<string, ZodType> } } | undefined;
        if (element?.def?.shape) walk(`${where}.${name}[]`, element.def.shape);
      }
    };
    for (const option of union) {
      const shape = (option as ZodObject).def.shape as Record<string, ZodType>;
      const kind = (shape.kind as unknown as { def: { values: string[] } }).def.values[0] ?? "";
      walk(kind, shape);
    }
    return found;
  }

  const fields = tripTitleFields();

  it("finds the kinds that carry a trip title", () => {
    // A floor, not a count: the walk must not pass vacuously over an empty list.
    expect(fields.length).toBeGreaterThanOrEqual(19);
    expect(fields.map((field) => field.where)).toContain("roll_call_stale");
    expect(fields.map((field) => field.where)).toContain("booking_confirmation");
    expect(fields.map((field) => field.where)).toContain("crew_schedule_change.changes[]");
  });

  it.each(fields.map((field) => [field.where, field.schema] as const))(
    "%s shortens 500 characters, keeps 200 whole, and still refuses blank",
    (_where, schema) => {
      const long = schema.safeParse("Reef ".repeat(100));
      expect(long.success).toBe(true);
      if (long.success) {
        expect((long.data as string).length).toBeLessThanOrEqual(NOTIFICATION_TRIP_TITLE_MAX);
        expect((long.data as string).endsWith("…")).toBe(true);
      }
      const exact = "x".repeat(NOTIFICATION_TRIP_TITLE_MAX);
      expect(schema.safeParse(exact)).toMatchObject({ success: true, data: exact });
      expect(schema.safeParse(`  ${exact}  `)).toMatchObject({ success: true, data: exact });
      expect(schema.safeParse("   ").success).toBe(false);
    },
  );

  it("sends a booking confirmation for a trip with a 500-character title, subject shortened", () => {
    const parsed = notificationSchema.parse({
      kind: "booking_confirmation",
      bookingId: "00000000-0000-4000-8000-000000000011",
      shopId: "00000000-0000-4000-8000-000000000012",
      to: "ana@example.com",
      locale: "en-US",
      diverName: "Ana Ruiz",
      shopName: "Blue Mantis Divers",
      tripTitle: "Reef ".repeat(100),
      startsAt: new Date("2026-11-01T12:00:00Z"),
      endsAt: new Date("2026-11-01T16:00:00Z"),
      timezone: "America/New_York",
      manageUrl: "https://diveday.example/ready/x",
    });
    if (parsed.kind !== "booking_confirmation") throw new Error("wrong kind");
    expect(parsed.tripTitle.length).toBeLessThanOrEqual(NOTIFICATION_TRIP_TITLE_MAX);
  });
});
