import { describe, expect, it } from "vitest";
import type { ZodObject, ZodType } from "zod";

import {
  NOTIFICATION_TRIP_TITLE_MAX,
  type Notification,
  notificationIdempotencyKey,
  notificationIsQueueable,
  notificationSchema,
  notificationSubjectEmail,
  notificationSubjectPhone,
} from "./kinds";
import { shopVoiceOf } from "./shop-voice";

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
  // `operator_alert` is a union of events inside the union of kinds, and
  // `address_confirmation` a union of purposes; each branch is checked on its
  // own, an alert event named `operator_alert_<event>`.
  const flat = union.flatMap((option) => {
    const nested = (option as unknown as { def: { options?: ZodType[] } }).def.options;
    return nested ?? [option];
  });
  return flat.map((option) => {
    const shape = (option as ZodObject).def.shape as Record<string, ZodType>;
    const kindName = (shape.kind as unknown as { def: { values: string[] } }).def.values[0] ?? "";
    const event =
      kindName === "operator_alert"
        ? (shape.event as unknown as { def: { values: string[] } }).def.values[0]
        : undefined;
    const kind = event ? `operator_alert_${event}` : kindName;
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
 * written for, `interest_received`'s `inquirerEmail` (issue #1298) — but also
 * when a kind already covered *grows a second one*, which a "returns something
 * truthy" assertion would have waved through.
 */
describe("every handle a notification carries is reachable by the erasure sweep", () => {
  /**
   * One sample per kind that carries a non-recipient handle, each field a
   * distinct value so the assertion below can tell which one came back.
   */
  const SUBJECT_SAMPLES: Record<string, Notification> = {
    interest_received: {
      kind: "interest_received",
      interestId: "00000000-0000-4000-8000-000000000001",
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
    operator_alert_new_account: {
      kind: "operator_alert",
      event: "new_account",
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
    operator_alert_setup_request: {
      kind: "operator_alert",
      event: "setup_request",
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
    expect(kinds).toContain("interest_received");
    expect(kinds).toContain("booking_confirmation");
  });

  it("recognizes an address by its schema rather than its name", () => {
    // The half that stops a future `replyTo` or `mailbox` slipping past. If
    // this ever reads zero, `unwrap` has lost track of zod's shape and every
    // assertion below is vacuous.
    const inquiry = branches().find((branch) => branch.kind === "interest_received");
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
    interest_received_ack: ["shopPhone"],
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
    // null. A phone-only interest is the case that matters: it has no address at
    // all, which is the hole the first version of this fix shipped.
    const phoneOnly = { ...SUBJECT_SAMPLES.interest_received } as Record<string, unknown>;
    delete phoneOnly.inquirerEmail;
    expect(notificationSubjectEmail(phoneOnly as Notification)).toBeNull();
    expect(notificationSubjectPhone(phoneOnly as Notification)).toBe("+1 305 555 0134");
  });
});

describe("operator_alert setup_request", () => {
  const alert = {
    kind: "operator_alert",
    event: "setup_request",
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

  it("names a system only by a switching guide's slug", () => {
    const named = { ...alert, currentSystem: "booking_system" };
    expect(
      notificationSchema.safeParse({ ...named, currentSystemGuide: "fareharbor" }).success,
    ).toBe(true);
    for (const currentSystemGuide of ["FareHarbor\r\nBcc: x@example.com", "constructor", ""]) {
      expect(notificationSchema.safeParse({ ...named, currentSystemGuide }).success).toBe(false);
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
    for (const option of union.flatMap(
      (branch) => (branch as unknown as { def: { options?: ZodType[] } }).def.options ?? [branch],
    )) {
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

describe("seat_already_held is keyed once per held seat per hour", () => {
  const heldBookingId = "00000000-0000-4000-8000-0000000000a1";
  const keyAt = (heldId: string, requestedAt: Date) =>
    notificationIdempotencyKey({
      kind: "seat_already_held",
      heldBookingId: heldId,
      shopId: "00000000-0000-4000-8000-0000000000a2",
      to: "holder@example.com",
      locale: "en-US",
      diverName: "Orla Organizer",
      shopName: "Blue Mantis",
      tripTitle: "Two-Tank Reef",
      startsAt: new Date("2026-10-20T14:00:00Z"),
      timezone: "America/New_York",
      requestedAt,
      attempt: "claim",
    });

  it("gives every attempt inside one hour the same key, and the next hour another", () => {
    const first = keyAt(heldBookingId, new Date("2026-10-16T10:01:00Z"));
    expect(keyAt(heldBookingId, new Date("2026-10-16T10:59:59Z"))).toBe(first);
    expect(keyAt(heldBookingId, new Date("2026-10-16T11:00:00Z"))).not.toBe(first);
  });

  it("keeps two held seats apart in the same hour", () => {
    const at = new Date("2026-10-16T10:01:00Z");
    expect(keyAt(heldBookingId, at)).not.toBe(keyAt("00000000-0000-4000-8000-0000000000a3", at));
  });
});

describe("operator_alert: one kind, five events, the keys the five kinds had", () => {
  const base = { kind: "operator_alert", to: "founder@diveday.invalid" } as const;
  const id = "00000000-0000-4000-8000-000000000003";

  it("keeps each event's idempotency key, so a retried alert still collapses to one send", () => {
    const keys = [
      {
        event: "new_account",
        userAccountId: id,
        shopId: id,
        ownerName: "Dana",
        ownerEmail: "d@x.invalid",
        shopName: "Blue",
        shopSlug: "blue",
      },
      { event: "demo_started", shopId: id, shopSlug: "demo-abc", role: "owner", source: "pricing" },
      {
        event: "usage_ceiling",
        ceilingId: "vercel-bandwidth",
        provider: "vercel",
        metric: "bandwidth",
        unit: "gib",
        level: "warn",
        periodKey: "2026-08",
        value: 80,
        ceiling: 100,
        percent: 80,
        overflow: "bills_overage",
      },
      {
        event: "setup_request",
        setupRequestId: id,
        shopName: "Reef",
        region: "Key Largo",
        runsBoat: true,
        currentSystem: "paper",
        contactName: "Ana",
        contactEmail: "a@x.invalid",
        source: "pricing",
        requestLocale: "en-US",
      },
      {
        event: "founder_digest",
        weekStart: "2026-10-12",
        weekEnd: "2026-10-18",
        diveDays: 0,
        diveDayShops: 0,
        demoEntries: [],
        setupRequests: [],
        unnotifiedSetupRequests: 0,
        stalls: [],
        bounces: { total: 0, lines: [] },
      },
    ].map((alert) => notificationIdempotencyKey(notificationSchema.parse({ ...base, ...alert })));
    expect(keys).toEqual([
      `new-account-alert/${id}`,
      "demo-started-alert/demo-abc",
      "usage-ceiling/vercel-bandwidth/2026-08/warn",
      `setup-request/${id}`,
      "founder-digest/2026-10-12",
    ]);
  });

  it("refuses an event carrying another event's payload", () => {
    expect(
      notificationSchema.safeParse({ ...base, event: "founder_digest", shopSlug: "x" }).success,
    ).toBe(false);
  });
});

describe("address_confirmation: one kind, three readers, the keys the three kinds had", () => {
  const ids = {
    shopId: "00000000-0000-4000-8000-000000000010",
    tokenId: "00000000-0000-4000-8000-000000000030",
    userAccountId: "00000000-0000-4000-8000-000000000020",
  };
  const common = {
    kind: "address_confirmation",
    shopId: ids.shopId,
    tokenId: ids.tokenId,
    to: "desk@shop.invalid",
    locale: "en-US",
    confirmUrl: "https://diveday.invalid/confirm-contact/raw-token-should-not-appear",
    expiresAt: new Date("2026-10-20T12:00:00.000Z"),
    timezone: "America/New_York",
  };
  const account = {
    ...common,
    purpose: "account",
    userAccountId: ids.userAccountId,
    ownerName: "Dana Reyes",
  };
  const shopContact = { ...common, purpose: "shop_contact", shopName: "Blue Mantis" };
  const shore = { ...common, purpose: "shore_alert", shopName: "Blue Mantis" };

  it("keys each send by its token row's id under the old kind's prefix, never the raw token", () => {
    const keys = [account, shopContact, shore].map((n) =>
      notificationIdempotencyKey(notificationSchema.parse(n)),
    );
    expect(keys).toEqual([
      `email-verification/${ids.tokenId}`,
      `contact-email-confirmation/${ids.tokenId}`,
      `shore-alert-confirmation/${ids.tokenId}`,
    ]);
    for (const key of keys) expect(key).not.toContain("raw-token");
  });

  it("queues the account and front-desk links and never the shore contact's", () => {
    expect(notificationIsQueueable(notificationSchema.parse(account))).toBe(true);
    expect(notificationIsQueueable(notificationSchema.parse(shopContact))).toBe(true);
    expect(notificationIsQueueable(notificationSchema.parse(shore))).toBe(false);
  });

  it("is spoken by the shop only for the shore contact", () => {
    expect(shopVoiceOf(notificationSchema.parse(account))).toBeNull();
    expect(shopVoiceOf(notificationSchema.parse(shopContact))).toBeNull();
    expect(shopVoiceOf(notificationSchema.parse(shore))).toBe("Blue Mantis");
  });

  it("holds each purpose to its own fields", () => {
    const { ownerName: _ownerName, ...noOwner } = account;
    const { shopName: _shopName, ...noShopName } = shore;
    expect(notificationSchema.safeParse(noOwner).success).toBe(false);
    expect(notificationSchema.safeParse(noShopName).success).toBe(false);
    expect(notificationSchema.safeParse({ ...shore, purpose: "stop" }).success).toBe(false);
  });
});

describe("the seat offer notification schema", () => {
  it("accepts a shop-scoped invitation payload for SES delivery", () => {
    const notification = {
      kind: "seat_offer" as const,
      answers: "wait_list" as const,
      interestId: "00000000-0000-4000-8000-000000000002",
      shopId: "00000000-0000-4000-8000-000000000010",
      to: "nora@dive.day",
      locale: "en-US" as const,
      diverName: "Nora Quinn",
      shopName: "Blue Mantis",
      tripTitle: "Two-Tank Reef",
      startsAt: new Date("2026-08-01T12:00:00.000Z"),
      endsAt: new Date("2026-08-01T15:00:00.000Z"),
      timezone: "America/New_York",
      bookingUrl: "https://dive.day/s/blue-mantis/trips/trip-1",
      offeredAt: new Date("2026-07-30T12:00:00.000Z"),
    };

    expect(notificationSchema.parse(notification)).toMatchObject(notification);
  });
});
