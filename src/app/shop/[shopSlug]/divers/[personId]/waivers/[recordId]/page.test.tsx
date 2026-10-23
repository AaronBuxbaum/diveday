import { and, eq } from "drizzle-orm";
import { isValidElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { personRoles, shops, waiverRecords } from "@/db/schema";
import { getShopBySlug } from "@/db/shops";
import type { DiveDaySession } from "@/lib/auth";
import type { Role } from "@/lib/authz";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import type { ShopAnswer } from "@/lib/waiver-questions";
import { seededTestDb } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";
import {
  SEEDED_CAPTAIN_EMAIL,
  SEEDED_OWNER_EMAIL,
  seededStaffPersonId,
} from "@/test/staff-session";
import type { ShowMedicalAnswersResult } from "./actions";

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
const { MedicalAnswers } = await import("./_components/MedicalAnswers");
const { ShopAnswersCard } = await import("./_components/ShopAnswersCard");

/** The seeded refusal (`seed-medical-review.ts`) names this physician. */
const PHYSICIAN = "Dr. Imani Reyes";
const FLAGGED = RSTC_QUESTIONNAIRE.questions.find((q) => q.id === "q3");
const UNFLAGGED = RSTC_QUESTIONNAIRE.questions.find((q) => q.id === "q4");

/**
 * Every string the page's element tree carries, in children and in every prop
 * (a client component's data arrives as props, and props are what reach the
 * browser), without rendering a component.
 */
function textIn(node: unknown, found: string[] = []): string[] {
  if (typeof node === "string") found.push(node);
  else if (Array.isArray(node)) for (const child of node) textIn(child, found);
  else if (isValidElement<Record<string, unknown>>(node))
    for (const value of Object.values(node.props)) textIn(value, found);
  else if (node && typeof node === "object")
    for (const value of Object.values(node)) textIn(value, found);
  return found;
}

/** The "Show answers" action the page hands `MedicalAnswers`, if any. */
function showActionIn(node: unknown): (() => Promise<ShowMedicalAnswersResult>) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = showActionIn(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ children?: unknown; show?: unknown }>(node)) return undefined;
  if (node.type === MedicalAnswers)
    return node.props.show as (() => Promise<ShowMedicalAnswersResult>) | undefined;
  return showActionIn(node.props.children);
}

/**
 * The words the shop-answers card says: a server component the tree only
 * names, so it is called with the props the page gave it.
 */
function shopAnswersTextIn(node: unknown): string | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = shopAnswersTextIn(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ children?: unknown }>(node)) return undefined;
  if (node.type === ShopAnswersCard)
    return textIn(ShopAnswersCard(node.props as Parameters<typeof ShopAnswersCard>[0])).join("\n");
  return shopAnswersTextIn(node.props.children);
}

async function renderAs(
  viewerRoles: Role[],
  options: {
    /** What the session claims, when it differs from the viewer's live `person_roles`. */
    sessionRoles?: Role[];
    /** Move the record to another shop first: the id is then that shop's, not this one's. */
    recordInAnotherShop?: boolean;
    /** Columns to write onto the record first: the shop's answers, a paper signature. */
    recordPatch?: Partial<typeof waiverRecords.$inferInsert>;
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

  if (options.recordPatch) {
    await db.update(waiverRecords).set(options.recordPatch).where(eq(waiverRecords.id, record.id));
  }

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
  return {
    text: textIn(tree).join("\n"),
    show: showActionIn(tree),
    shopAnswersText: shopAnswersTextIn(tree) ?? "",
  };
}

describe("a signed release's medical answers", () => {
  // Issue #2157: no render carries the full questionnaire, for anyone. An
  // owner or manager reads the physician and gets "Show answers", whose action
  // records the read before it sends every answer back.
  it.each([
    ["owner", ["owner"]],
    ["manager", ["manager"]],
  ] as const)(
    "the %s reads the physician's name, and every answer only through Show answers",
    async (_, roles) => {
      const { text, show } = await renderAs([...roles]);
      expect(text).toContain(FLAGGED?.prompt);
      expect(text).not.toContain(UNFLAGGED?.prompt);
      expect(text).toContain(PHYSICIAN);
      if (!show) throw new Error("expected a Show answers action");
      const shown = await show();
      if (!shown.ok) throw new Error("expected Show answers to send the answers");
      const prompts = shown.answers.map((answer) => answer.prompt);
      expect(prompts).toContain(FLAGGED?.prompt);
      expect(prompts).toContain(UNFLAGGED?.prompt);
    },
  );

  it.each([["instructor"], ["divemaster"], ["captain"], ["crew"]] as const)(
    "a %s sees only the flagged prompt, never the other answers or the physician",
    async (role) => {
      const { text, show } = await renderAs([role]);
      expect(text).toContain(FLAGGED?.prompt);
      expect(text).not.toContain(UNFLAGGED?.prompt);
      expect(text).not.toContain(PHYSICIAN);
      expect(show).toBeUndefined();
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
    const { text, show } = await renderAs(["crew"], { sessionRoles: ["owner"] });
    expect(text).toContain(FLAGGED?.prompt);
    expect(text).not.toContain(UNFLAGGED?.prompt);
    expect(text).not.toContain(PHYSICIAN);
    expect(show).toBeUndefined();
  });

  it("does not find another shop's record, even for this shop's owner", async () => {
    await expect(renderAs(["owner"], { recordInAnotherShop: true })).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404/,
    );
  });
});

/**
 * The shop's own questions (glossary *Shop question*): every staff role reads
 * the answers, as they read the release, and three states never blur
 * (dive-domain review C5): answered, left blank, and not asked.
 */
describe("a signed release's answers to the shop's questions", () => {
  const ANSWERS: ShopAnswer[] = [
    {
      id: "demodives01",
      kind: "number",
      prompt: "Dives logged so far",
      required: false,
      answer: 40,
    },
    {
      id: "demoheard01",
      kind: "choice",
      prompt: "How did you hear about us?",
      required: false,
      options: ["A friend", "Online search"],
      answer: null,
    },
  ];

  it.each([["crew"], ["owner"]] as const)(
    "a %s reads what the diver wrote, the blank, and the question this version did not ask",
    async (role) => {
      const { shopAnswersText: text } = await renderAs([role], {
        recordPatch: { shopAnswers: ANSWERS, signatureMethod: "typed_consent" },
      });
      expect(text).toContain("Answers to your questions");
      expect(text).toContain("What the diver wrote. DiveDay does not check these answers.");
      expect(text).toContain("Dives logged so far");
      expect(text).toMatch(/40, as of /);
      expect(text).toContain("How did you hear about us?");
      expect(text).toContain("Left blank");
      // The seeded current version also asks about insurance, which the
      // snapshot above never did.
      expect(text).toMatch(/Not asked \(signed on version \d+\)/);
    },
  );

  it("says a paper release records no answers, rather than inventing any", async () => {
    const { shopAnswersText: text } = await renderAs(["owner"], {
      recordPatch: { signatureMethod: "in_person_attested" },
    });
    expect(text).toContain("Not recorded in DiveDay: this release was signed on paper.");
    expect(text).not.toContain("Not asked (signed");
  });
});
