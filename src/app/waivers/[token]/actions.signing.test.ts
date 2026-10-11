import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { people, waiverRecords } from "@/db/schema";
import { medicalQuestionField, questionnaireForJurisdiction } from "@/lib/medical";
import { seededShopContext } from "@/test/db";

/**
 * The signing form's two doors, which were closures inside `page.tsx` until they moved here.
 * They now read the link's context (record, questionnaire, guardian rule) from the token at
 * submit rather than from the render's scope, so these cases hold the whole path against a real
 * waiver record: the throttle, a dead link, a refused field, a draft, and a signature.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn() };
});
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});
vi.mock("@/i18n/request", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/i18n/request")>();
  return { ...actual, requestFirstHandLocale: vi.fn(async () => "en-US") };
});
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const { getDb } = await import("@/db/client");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { issueWaiverRequest } = await import("@/db/waivers");
const { completeWaiverAction, saveWaiverDraftAction } = await import("./actions");

async function redirectedTo(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

/** A fresh waiver link for an adult on the seeded shop, with no booking behind it. */
async function openLink() {
  const { db, shop } = await seededShopContext();
  vi.mocked(getDb).mockResolvedValue(db);
  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.shopId, shop.id), isNull(people.dateOfBirth), isNull(people.deletedAt)))
    .limit(1);
  if (!person) throw new Error("seeded shop has no person without a date of birth");
  const issued = await issueWaiverRequest(db, { shopId: shop.id, personId: person.id });
  if (!issued.ok) throw new Error(`waiver request refused: ${issued.reason}`);
  return { db, shop, person, token: issued.token, recordId: issued.recordId };
}

/** Every primary question answered "no", which needs no physician. */
function signedForm(
  shop: { jurisdiction: Parameters<typeof questionnaireForJurisdiction>[0] },
  fields: Record<string, string>,
): FormData {
  const form = new FormData();
  const questionnaire = questionnaireForJurisdiction(shop.jurisdiction);
  for (const question of questionnaire.questions) {
    if (!question.parentId) form.set(medicalQuestionField(question.id), "no");
  }
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

describe("the signing doors", () => {
  it("throttle before reading anything", async () => {
    const { token, shop } = await openLink();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 1_000 });
    expect(await redirectedTo(() => saveWaiverDraftAction(token, signedForm(shop, {})))).toBe(
      `/waivers/${token}?error=rate`,
    );
    expect(await redirectedTo(() => completeWaiverAction(token, signedForm(shop, {})))).toBe(
      `/waivers/${token}?error=rate`,
    );
  });

  it("answer a link that names no open record as unavailable", async () => {
    const { shop } = await openLink();
    const dead = "not-a-real-token";
    expect(await redirectedTo(() => completeWaiverAction(dead, signedForm(shop, {})))).toBe(
      `/waivers/${dead}?error=unavailable`,
    );
  });

  it("save a draft through the link", async () => {
    const { db, token, shop, recordId } = await openLink();
    expect(
      await redirectedTo(() =>
        saveWaiverDraftAction(token, signedForm(shop, { signerName: "Half Way" })),
      ),
    ).toBe(`/waivers/${token}?saved=1`);
    const [record] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
    expect(record?.status).toBe("pending");
    expect(record?.draftMedicalAnswers).not.toBeNull();
  });

  it("send a signature under another name back to the name field", async () => {
    const { token, shop } = await openLink();
    const target = await redirectedTo(() =>
      completeWaiverAction(
        token,
        signedForm(shop, { signerName: "Somebody Else Entirely", acknowledged: "on" }),
      ),
    );
    expect(target).toMatch(
      new RegExp(`^/waivers/${token}\\?error=invalid&field=signerNameMismatch&at=\\w+#`),
    );
  });

  it("sign the release under the name on file", async () => {
    const { db, token, shop, person, recordId } = await openLink();
    expect(
      await redirectedTo(() =>
        completeWaiverAction(
          token,
          signedForm(shop, { signerName: person.fullName, acknowledged: "on" }),
        ),
      ),
    ).toBe(`/waivers/${token}`);
    const [record] = await db.select().from(waiverRecords).where(eq(waiverRecords.id, recordId));
    expect(record?.status).not.toBe("pending");
  });
});
