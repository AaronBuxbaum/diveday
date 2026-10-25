import { describe, expect, it, vi } from "vitest";
import { staffSession } from "@/test/staff-session";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn(async () => ({})) };
});
vi.mock("@/db/boat-snags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/boat-snags")>();
  return { ...actual, noteSnag: vi.fn(async () => ({ ok: true }) as const) };
});
vi.mock("@/lib/session", async () =>
  (await import("@/test/staff-session")).sessionMockOverStaffSession(),
);
const { requireStaffSession } = await import("@/lib/session");
const { noteSnag } = await import("@/db/boat-snags");
const { noteSnagAction } = await import("./actions");

const SHOP = { id: "00000000-0000-4000-8000-000000000001", slug: "blue-mantis" };
const ctx = { shopSlug: SHOP.slug, tripId: "00000000-0000-4000-8000-0000000000aa" };
const ITEM = "00000000-0000-4000-8000-0000000000b1";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/**
 * **A snag names the line it is about, or it is not written** (layer 4
 * review, dde-a F3 / dde-b 3): the picker preselects nothing, and a form that
 * arrives without a line (an old page, a hand-built post) is refused here
 * before any write, never filed against a line the crew did not choose.
 */
describe("noteSnagAction", () => {
  vi.mocked(requireStaffSession).mockResolvedValue(
    staffSession({
      shopId: SHOP.id,
      shopSlug: SHOP.slug,
      personId: "00000000-0000-4000-8000-0000000000c1",
    }),
  );

  for (const [what, fields] of [
    ["an empty line", { checklistItemId: "", note: "VHF crackles on 16" }],
    ["no line at all", { note: "VHF crackles on 16" }],
    ["a line that is not an id", { checklistItemId: "first", note: "VHF crackles on 16" }],
  ] as const) {
    it(`refuses ${what} and writes nothing`, async () => {
      vi.mocked(noteSnag).mockClear();
      await expect(noteSnagAction(ctx, null, form(fields))).resolves.toEqual({
        ok: false,
        reason: "note_invalid",
      });
      expect(noteSnag).not.toHaveBeenCalled();
    });
  }

  it("writes the note against the line the crew picked", async () => {
    vi.mocked(noteSnag).mockClear();
    await expect(
      noteSnagAction(ctx, null, form({ checklistItemId: ITEM, note: "VHF crackles on 16" })),
    ).resolves.toEqual({ ok: true });
    expect(noteSnag).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ checklistItemId: ITEM, tripId: ctx.tripId }),
    );
  });
});
