// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A Server Action's arguments come off the wire whatever its signature says,
 * so `wanted` is checked to be a real boolean before it reaches the row
 * (security review): a string "false" is truthy, and a stored non-boolean would
 * read back as neither answer.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/db/weekly-digest", () => ({ setWeeklyDigestChoice: vi.fn() }));

const { requireShopSurface } = await import("@/lib/session");
const { setWeeklyDigestChoice } = await import("@/db/weekly-digest");
const { setWeeklyDigestAction } = await import("./actions");

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.mocked(setWeeklyDigestChoice).mockReset();
  vi.mocked(requireShopSurface).mockResolvedValue({
    db: {},
    shop: { id: SHOP_ID, slug: "reef-life" },
    session: { user: { personId: PERSON_ID } },
  } as never);
});

describe("setWeeklyDigestAction", () => {
  it.each([true, false])("records %s as the signed-in staffer's own answer", async (wanted) => {
    await setWeeklyDigestAction("reef-life", wanted);
    expect(setWeeklyDigestChoice).toHaveBeenCalledWith(
      {},
      { shopId: SHOP_ID, personId: PERSON_ID, wanted },
    );
  });

  it.each([["false"], ["true"], [1], [null], [undefined], [{}]])(
    "refuses %j without writing",
    async (wanted) => {
      await setWeeklyDigestAction("reef-life", wanted);
      expect(setWeeklyDigestChoice).not.toHaveBeenCalled();
    },
  );
});
