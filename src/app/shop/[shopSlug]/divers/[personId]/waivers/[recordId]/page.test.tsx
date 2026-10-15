import { and, eq } from "drizzle-orm";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { personRoles, shops, waiverRecords } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "@/test/staff-session";

// The page is invoked directly, outside Next's request scope, so the db handle,
// better-auth and request headers are stubbed and nothing else (same shape as
// settings/team/page.test.tsx). The roles that decide what renders are read
// live from `person_roles`, so each case rewrites the viewer's rows.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<DiveDaySession | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const { auth } = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<DiveDaySession | null>>>;
};
const SignedWaiverPage = (await import("./page")).default;

/** The seeded refusal (`seed-medical-review.ts`) names this physician. */
const PHYSICIAN = "Dr. Imani Reyes";
const FLAGGED = RSTC_QUESTIONNAIRE.questions.find((q) => q.id === "q3");
const UNFLAGGED = RSTC_QUESTIONNAIRE.questions.find((q) => q.id === "q4");

/** Every string the page's element tree carries, without rendering a component. */
function textIn(node: unknown, found: string[] = []): string[] {
  if (typeof node === "string") found.push(node);
  else if (Array.isArray(node)) for (const child of node) textIn(child, found);
  else if (isValidElement<{ children?: unknown }>(node)) textIn(node.props.children, found);
  return found;
}

async function renderAs(
  viewerRoles: Role[],
  options: {
    /** What the session claims, when it differs from the viewer's live `person_roles`. */
    sessionRoles?: Role[];
    /** Move the record to another shop first: the id is then that shop's, not this one's. */
    recordInAnotherShop?: boolean;
  } = {},
) {
  if (!FLAGGED || !UNFLAGGED) throw new Error("questionnaire changed shape");
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const [record] = await db
    .select({ id: waiverRecords.id, personId: waiverRecords.personId })
    .from(waiverRecords)
    .where(
      and(
        eq(waiverRecords.shopId, shop.id),
        eq(waiverRecords.medicalClearancePhysicianName, PHYSICIAN),
      ),
    )
    .limit(1);
  if (!record) throw new Error("seeded refusal missing");
  // A full questionnaire: one referral yes, every other answer no.
  const answers = emptyMedicalAnswers(RSTC_QUESTIONNAIRE);
  answers.responses[FLAGGED.id] = true;
  await db
    .update(waiverRecords)
    .set({ medicalAnswers: answers })
    .where(eq(waiverRecords.id, record.id));

  const email = viewerRoles.includes("owner") ? SEEDED_OWNER_EMAIL : SEEDED_CAPTAIN_EMAIL;
  const viewer = await seededStaffPersonId(db, shop.id, email);
  await db.delete(personRoles).where(eq(personRoles.personId, viewer));
  await db.insert(personRoles).values(viewerRoles.map((role) => ({ personId: viewer, role })));
  if (options.recordInAnotherShop) {
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Reef Runners", slug: "reef-runners", timezone: "America/New_York" })
      .returning({ id: shops.id });
    if (!otherShop) throw new Error("second shop insert failed");
    await db
      .update(waiverRecords)
      .set({ shopId: otherShop.id })
      .where(eq(waiverRecords.id, record.id));
  }
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue({
    user: {
      personId: viewer,
      shopId: shop.id,
      shopSlug: "blue-mantis",
      name: "Viewer",
      email,
      roles: options.sessionRoles ?? viewerRoles,
    },
  });
  const tree = await SignedWaiverPage({
    params: Promise.resolve({
      shopSlug: "blue-mantis",
      personId: record.personId,
      recordId: record.id,
    }),
  });
  return textIn(tree).join("\n");
}

describe("a signed release's medical answers", () => {
  it.each([
    ["owner", ["owner"]],
    ["manager", ["manager"]],
  ] as const)("the %s reads every answer and the physician's name", async (_, roles) => {
    const text = await renderAs([...roles]);
    expect(text).toContain(FLAGGED?.prompt);
    expect(text).toContain(UNFLAGGED?.prompt);
    expect(text).toContain(PHYSICIAN);
  });

  it.each([["instructor"], ["divemaster"], ["captain"], ["crew"]] as const)(
    "a %s sees only the flagged prompt, never the other answers or the physician",
    async (role) => {
      const text = await renderAs([role]);
      expect(text).toContain(FLAGGED?.prompt);
      expect(text).not.toContain(UNFLAGGED?.prompt);
      expect(text).not.toContain(PHYSICIAN);
    },
  );
});

/**
 * The wall is the database's, never the session's (security review of the
 * test-suite layer 1): a session that claims more than `person_roles` grants
 * reads what the live rows grant, and a record id from another shop is not
 * found, whoever asks.
 */
describe("a signed release's medical answers, against a session that claims too much", () => {
  it("reads the live roles, not a session that claims the owner's", async () => {
    const text = await renderAs(["crew"], { sessionRoles: ["owner"] });
    expect(text).toContain(FLAGGED?.prompt);
    expect(text).not.toContain(UNFLAGGED?.prompt);
    expect(text).not.toContain(PHYSICIAN);
  });

  it("does not find another shop's record, even for this shop's owner", async () => {
    await expect(renderAs(["owner"], { recordInAnotherShop: true })).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404/,
    );
  });
});
