// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFormDraft, saveFormDraft } from "@/db/form-drafts";
import { people, shops } from "@/db/schema";
import type { DiveDaySession } from "@/lib/auth";
import { fileScopedShopContext } from "@/test/db";
import { staffSession } from "@/test/staff-session";

vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { requireStaffSession } = await import("@/lib/session");
const { bindFormDraft } = await import("./form-draft-props");
const ctx = fileScopedShopContext();
let currentSession: DiveDaySession;

beforeEach(() => {
  vi.mocked(getDb).mockResolvedValue(ctx.db);
  vi.mocked(requireStaffSession).mockImplementation(async () => currentSession);
});

function actionsFrom(origin: DiveDaySession) {
  return bindFormDraft(origin.user).actions;
}

async function identities(otherShop: boolean) {
  const { db, shop } = ctx;
  const [secondShop] = otherShop
    ? await db
        .insert(shops)
        .values({ name: "Second desk", slug: "draft-other-shop", timezone: "UTC" })
        .returning()
    : [shop];
  if (!secondShop) throw new Error("missing second shop");
  const [first] = await db
    .insert(people)
    .values({ shopId: shop.id, fullName: "First staff" })
    .returning();
  const [second] = await db
    .insert(people)
    .values({ shopId: secondShop.id, fullName: "Second staff" })
    .returning();
  if (!first || !second) throw new Error("missing staff");
  const origin = staffSession({ shopId: shop.id, shopSlug: shop.slug, personId: first.id });
  const replacement = staffSession({
    shopId: secondShop.id,
    shopSlug: secondShop.slug,
    personId: second.id,
  });
  origin.user.sessionId = "first-session";
  replacement.user.sessionId = "second-session";
  return { origin, replacement };
}

describe("draft originating identity", () => {
  it.each([false, true])(
    "a queued save never copies old input to a replacement account (other shop: %s)",
    async (otherShop) => {
      const { origin, replacement } = await identities(otherShop);
      const actions = actionsFrom(origin);
      currentSession = origin;
      await actions.save("new_diver", [["fullName", "First saved input"]]);
      await saveFormDraft(ctx.db, {
        shopId: replacement.user.shopId,
        personId: replacement.user.personId,
        form: "new_diver",
        fields: [["fullName", "Replacement staff's own draft"]],
      });
      let release = () => {};
      const pendingResponse = new Promise<void>((resolve) => {
        release = resolve;
      });
      const queuedSave = pendingResponse.then(() =>
        actions.save("new_diver", [["fullName", "Old form's final input"]]),
      );
      currentSession = replacement;
      release();
      await queuedSave;
      expect(
        (
          await readFormDraft(
            ctx.db,
            replacement.user.shopId,
            replacement.user.personId,
            "new_diver",
          )
        )?.fields,
      ).toEqual({ fullName: "Replacement staff's own draft" });
      expect(
        (await readFormDraft(ctx.db, origin.user.shopId, origin.user.personId, "new_diver"))
          ?.fields,
      ).toEqual({ fullName: "First saved input" });
    },
  );

  it("a delayed Start over never discards the replacement account's draft", async () => {
    const { origin, replacement } = await identities(true);
    const actions = actionsFrom(origin);
    currentSession = origin;
    await actions.save("new_diver", [["fullName", "First saved input"]]);
    await saveFormDraft(ctx.db, {
      shopId: replacement.user.shopId,
      personId: replacement.user.personId,
      form: "new_diver",
      fields: [["fullName", "Replacement staff's own draft"]],
    });
    currentSession = replacement;
    await actions.discard("new_diver");
    expect(
      (await readFormDraft(ctx.db, replacement.user.shopId, replacement.user.personId, "new_diver"))
        ?.fields,
    ).toEqual({ fullName: "Replacement staff's own draft" });
  });

  it("an old form cannot write or discard after the same person signs in with a new session", async () => {
    const { origin } = await identities(false);
    const actions = actionsFrom(origin);
    currentSession = origin;
    await actions.save("new_diver", [["fullName", "First saved input"]]);
    currentSession = { user: { ...origin.user, sessionId: "replacement-session" } };
    await actions.save("new_diver", [["fullName", "Stale form input"]]);
    await actions.discard("new_diver");
    expect(
      (await readFormDraft(ctx.db, origin.user.shopId, origin.user.personId, "new_diver"))?.fields,
    ).toEqual({ fullName: "First saved input" });
  });

  it("a matching originating session can save filtered fields and discard its own draft", async () => {
    const { origin } = await identities(false);
    const actions = actionsFrom(origin);
    currentSession = origin;
    await actions.save("new_diver", [
      ["fullName", "Allowed name"],
      ["cardNumber", "4242"],
      ["medicalAnswer", "No"],
    ]);
    expect(
      (await readFormDraft(ctx.db, origin.user.shopId, origin.user.personId, "new_diver"))?.fields,
    ).toEqual({ fullName: "Allowed name" });
    await actions.discard("new_diver");
    expect(
      await readFormDraft(ctx.db, origin.user.shopId, origin.user.personId, "new_diver"),
    ).toBeNull();
  });
});
