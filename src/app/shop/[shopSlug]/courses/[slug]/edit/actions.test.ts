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
vi.mock("@/db/authz", () => ({ canPersonConfigureTrips: vi.fn(async () => true) }));
vi.mock("@/db/course-forms", () => ({ setCourseFormRequirements: vi.fn() }));

const { revalidatePath } = await import("next/cache");
const { getCourseBySlug, pullCourseTemplateUpdates } = await import("@/db/courses");
const { requireStaffSession } = await import("@/lib/session");
const { canPersonConfigureTrips } = await import("@/db/authz");
const { setCourseFormRequirements } = await import("@/db/course-forms");
const { pullCourseTemplateUpdatesAction, saveCourseFormRequirementsAction } = await import(
  "./actions"
);

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

describe("saveCourseFormRequirementsAction", () => {
  const FORM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const FORM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const FORM_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  async function posted(fields: [string, string][]) {
    const formData = new FormData();
    for (const [key, value] of fields) formData.append(key, value);
    try {
      await saveCourseFormRequirementsAction("open-water-diver", formData);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
      throw error;
    }
    throw new Error("action returned without redirecting");
  }

  it("saves the ticked forms in the order their boxes give, blanks last", async () => {
    vi.mocked(setCourseFormRequirements).mockResolvedValue({ ok: true });

    const to = await posted([
      ["formId", FORM_A],
      ["formId", FORM_B],
      ["formId", FORM_C],
      [`order-${FORM_A}`, ""],
      [`order-${FORM_B}`, "2"],
      [`order-${FORM_C}`, "1"],
    ]);

    expect(to).toBe("/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-saved#forms");
    expect(setCourseFormRequirements).toHaveBeenCalledWith(
      {},
      { shopId: SHOP_ID, courseId: COURSE_ID, formIds: [FORM_C, FORM_B, FORM_A] },
    );
  });

  it("saves an empty list when nothing is ticked: the course asks for no forms", async () => {
    vi.mocked(setCourseFormRequirements).mockResolvedValue({ ok: true });

    await posted([]);

    expect(setCourseFormRequirements).toHaveBeenCalledWith(
      {},
      { shopId: SHOP_ID, courseId: COURSE_ID, formIds: [] },
    );
  });

  it("refuses a staffer who cannot configure trips, and writes nothing", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValueOnce(false);

    expect(await posted([["formId", FORM_A]])).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-not-authorized#forms",
    );
    expect(setCourseFormRequirements).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a uuid before it reaches the database", async () => {
    expect(await posted([["formId", "not-a-form"]])).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-invalid#forms",
    );
    expect(setCourseFormRequirements).not.toHaveBeenCalled();
  });

  it("says so when the list names a form that is not this shop's", async () => {
    vi.mocked(setCourseFormRequirements).mockResolvedValue({ ok: false, reason: "unknown_form" });

    expect(await posted([["formId", FORM_A]])).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-invalid#forms",
    );
  });
});
