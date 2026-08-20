import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`);
  }),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/courses", () => ({
  getCourseBySlug: vi.fn(),
  pullCourseTemplateUpdates: vi.fn(),
  updateCourse: vi.fn(),
  updateCourseContent: vi.fn(),
}));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, target: string) => {
    throw new Error(`REDIRECT:${target}`);
  }),
}));
vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));

const { revalidatePath } = await import("next/cache");
const { getCourseBySlug, pullCourseTemplateUpdates } = await import("@/db/courses");
const { requireStaffSession } = await import("@/lib/session");
const { pullCourseTemplateUpdatesAction } = await import("./actions");

const SHOP_ID = "3f4b1a2c-1111-4222-8333-444444444444";
const COURSE_ID = "11111111-1111-4111-8111-111111111111";

async function redirectedTo(mode: "preserve-shop-edits" | "replace-template-copy") {
  try {
    await pullCourseTemplateUpdatesAction("blue-mantis", "open-water-diver", mode, new FormData());
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => {
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId: SHOP_ID, shopSlug: "blue-mantis", personId: "staff" },
  } as never);
  vi.mocked(getCourseBySlug).mockResolvedValue({
    id: COURSE_ID,
    slug: "open-water-diver",
  } as never);
});

afterEach(() => vi.clearAllMocks());

describe("pullCourseTemplateUpdatesAction", () => {
  it("uses the safe merge mode and revalidates both staff and public pages", async () => {
    vi.mocked(pullCourseTemplateUpdates).mockResolvedValue({ status: "updated" } as never);

    expect(await redirectedTo("preserve-shop-edits")).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=template-updated",
    );
    expect(pullCourseTemplateUpdates).toHaveBeenCalledWith(
      {},
      SHOP_ID,
      COURSE_ID,
      "preserve-shop-edits",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/s/blue-mantis/courses/open-water-diver");
  });

  it("does not claim success when the source revision is unavailable", async () => {
    vi.mocked(pullCourseTemplateUpdates).mockResolvedValue({ status: "unavailable" });

    expect(await redirectedTo("replace-template-copy")).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=template-update-unavailable",
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
