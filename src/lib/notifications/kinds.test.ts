import { describe, expect, it } from "vitest";
import type { ZodObject, ZodType } from "zod";

import {
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

  it("recognises an address by its schema rather than its name", () => {
    // The half that stops a future `replyTo` or `mailbox` slipping past. If
    // this ever reads zero, `unwrap` has lost track of zod's shape and every
    // assertion below is vacuous.
    const inquiry = branches().find((branch) => branch.kind === "course_inquiry");
    expect(inquiry?.email).toEqual(["to", "inquirerEmail"]);
    expect(inquiry?.phone).toEqual(["inquirerPhone"]);
  });

  it.each(branches())("$kind surfaces every handle it carries", ({ kind, email, phone }) => {
    const extra = [...email.filter((field) => field !== "to"), ...phone];
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
          "erased diver's queued row keeps it.",
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
