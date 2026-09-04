import { describe, expect, it } from "vitest";
import type { ZodObject, ZodType } from "zod";

import { type Notification, notificationSchema, notificationSubjectEmail } from "./kinds";

/**
 * Every branch of the discriminated union, by its `kind`, with the field names
 * it declares.
 *
 * Reached through the parsed schema rather than by importing the twenty-three
 * private consts: the union is what the rest of the app sees, and a branch
 * somebody forgets to add to it is not a kind at all.
 */
function branches(): { kind: string; fields: string[] }[] {
  // `notificationSchema` is `discriminatedUnion(...).and(...)`, so the union
  // itself is the intersection's left side.
  const union = (
    notificationSchema as unknown as { def: { left: { def: { options: ZodType[] } } } }
  ).def.left.def.options;
  return union.map((option) => {
    const shape = (option as ZodObject).def.shape as Record<string, ZodType>;
    const kindLiteral = (shape.kind as unknown as { def: { values: string[] } }).def.values[0];
    return { kind: kindLiteral, fields: Object.keys(shape) };
  });
}

/**
 * **The guard that keeps `notificationSubjectEmail` honest.**
 *
 * Legal erasure can only match handles lifted into real columns — the payload
 * is sealed, so no `->>` reaches inside it (issue #1297). `to` is one handle
 * and `subject_email` is the other, and the second is populated from
 * `notificationSubjectEmail`, which is a `switch` somebody has to remember to
 * extend.
 *
 * This is what remembers for them: a kind that declares an address field other
 * than `to` and does not surface it fails here, naming the field. That is
 * exactly the shape of the bug it was written for — `course_inquiry` mails the
 * shop's front desk and carried the diver's `inquirerEmail` where no sweep
 * could see it (issue #1298).
 */
describe("every address a notification carries is reachable by the erasure sweep", () => {
  /** Field names that hold an address. Named by convention, which is the convention. */
  const carriesAnAddress = (field: string) => field === "to" || /email$/i.test(field);

  const SUBJECT_SAMPLES: Partial<Record<string, Notification>> = {
    course_inquiry: {
      kind: "course_inquiry",
      courseInquiryId: "00000000-0000-4000-8000-000000000001",
      shopId: "00000000-0000-4000-8000-000000000002",
      to: "desk@shop.invalid",
      locale: "en-US",
      shopName: "Blue Mantis Divers",
      courseTitle: "Open Water",
      inquirerEmail: "diver@example.invalid",
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

  it.each(branches())("$kind surfaces every address it carries", ({ kind, fields }) => {
    const extra = fields.filter((field) => carriesAnAddress(field) && field !== "to");
    if (extra.length === 0) return;

    const sample = SUBJECT_SAMPLES[kind];
    expect(
      sample,
      `${kind} declares ${extra.join(", ")} beside \`to\`, so the person it is *about* is not the ` +
        "person it is addressed to. Add a case to `notificationSubjectEmail` (kinds.ts) so legal " +
        "erasure can reach a queued row for them, and a sample here.",
    ).toBeDefined();
    if (!sample) return;
    expect(notificationSubjectEmail(sample)).toBeTruthy();
  });

  it("says nothing for a kind whose subject is its recipient", () => {
    expect(
      notificationSubjectEmail({
        kind: "password_changed",
        userAccountId: "00000000-0000-4000-8000-000000000005",
        shopId: "00000000-0000-4000-8000-000000000006",
        to: "dana@shop.invalid",
        locale: "en-US",
        ownerName: "Dana Reyes",
        changedAt: new Date("2026-09-04T00:00:00Z"),
      } as Notification),
    ).toBeNull();
  });

  it("hands back null rather than undefined when the optional address is absent", () => {
    // The column is nullable and the writer inserts this value directly, so
    // `undefined` would silently become a Drizzle default rather than a null.
    const withoutInquirer = { ...SUBJECT_SAMPLES.course_inquiry } as Record<string, unknown>;
    delete withoutInquirer.inquirerEmail;
    expect(notificationSubjectEmail(withoutInquirer as Notification)).toBeNull();
  });
});
