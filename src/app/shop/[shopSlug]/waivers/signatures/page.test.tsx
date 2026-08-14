import type { Session } from "next-auth";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { getShopBySlug } from "@/db/shops";
import { listShopStaff } from "@/db/staff-accounts";
import { listWaiverIntegrityAudit } from "@/db/waivers";
import { seededTestDb } from "@/test/db";
import { findElements } from "@/test/jsx-inspect";
import { nextHeadersStub } from "@/test/next-headers";

// Same mocking shape as ../../orders/page.test.tsx: the page is invoked
// directly, outside Next's request scope, so the three things that only exist
// inside one (the db handle, next-auth, and request headers) are stubbed and
// nothing else.
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/lib/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
const authModule = (await import("@/lib/auth")) as unknown as {
  auth: ReturnType<typeof vi.fn<() => Promise<Session | null>>>;
};
const auth = authModule.auth;
const WaiverSignaturesPage = (await import("./page")).default;

const SHOP_SLUG = "blue-mantis";

/** The seeded shop signed in as its owner, with one real signed-record id. */
async function shopWithSignedRecords() {
  const db: AppDb = await seededTestDb();
  const shop = await getShopBySlug(db, SHOP_SLUG);
  if (!shop) throw new Error("demo shop missing");
  const owner = (await listShopStaff(db, shop.id)).find((staff) => staff.roles.includes("owner"));
  if (!owner) throw new Error("the seed has no owner");
  const audit = await listWaiverIntegrityAudit(db, shop.id, { page: 1 });
  const record = audit.entries[0];
  if (!record) throw new Error("the seed has no signed waiver records");
  vi.mocked(getDb).mockResolvedValue(db);
  vi.mocked(auth).mockResolvedValue({
    user: {
      personId: owner.personId,
      shopId: shop.id,
      shopSlug: SHOP_SLUG,
      name: owner.fullName,
      roles: owner.roles,
    },
    expires: new Date(Date.now() + 60_000).toISOString(),
  });
  return { recordId: record.id };
}

function renderWith(searchParams: Record<string, string> = {}) {
  return WaiverSignaturesPage({
    params: Promise.resolve({ shopSlug: SHOP_SLUG }),
    searchParams: Promise.resolve(searchParams),
  });
}

/** Whether the pinned "signed record" section — the `?record=` highlight — rendered. */
function hasPinnedRecord(element: unknown): boolean {
  return findElements<{ "aria-labelledby"?: string }>(element, "section").some(
    (section: ReactElement<{ "aria-labelledby"?: string }>) =>
      section.props["aria-labelledby"] === "signed-record-heading",
  );
}

/*
 * `?record=` is the roster's "View signed record" deep link.
 * `waiver_records.id` is a `uuid` column, so a truncated or hand-edited value
 * used to reach `getSignedWaiverRecordForShop` as a literal Postgres cannot
 * parse — `invalid input syntax for type uuid`, a 500 on a staff page
 * (FU-20260814-orders-stray-person-id-500's sweep).
 */
describe("the ?record= highlight", () => {
  it("pins the record the roster linked to", async () => {
    const { recordId } = await shopWithSignedRecords();
    expect(hasPinnedRecord(await renderWith({ record: recordId }))).toBe(true);
  });

  it("treats a malformed record id as no highlight at all", async () => {
    await shopWithSignedRecords();
    // The log itself still renders — which is the page the staffer came for.
    const element = await renderWith({ record: "nope" });
    expect(hasPinnedRecord(element)).toBe(false);
    expect(
      findElements<{ "aria-labelledby"?: string }>(element, "section").some(
        (section: ReactElement<{ "aria-labelledby"?: string }>) =>
          section.props["aria-labelledby"] === "signed-records-heading",
      ),
    ).toBe(true);
  });
});
