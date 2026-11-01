import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((target: string) => {
    throw new Error(`REDIRECT:${target}`);
  }),
}));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/courses", () => ({
  getCourseBySlug: vi.fn(),
  pullCourseTemplateUpdates: vi.fn(),
  setCourseVisibility: vi.fn(),
  updateCourse: vi.fn(),
  updateCourseContent: vi.fn(),
}));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, target: string) => {
    throw new Error(`REDIRECT:${target}`);
  }),
}));
// `requireShopSurface` is the gate these actions take; it stands on
// `requireStaffSession`, which is the seam this file steers. The slug check
// itself is exercised against the real gate in `src/app/shop/[shopSlug]/slug-actions.authz.test.ts`.
vi.mock("@/lib/session", () => {
  const requireStaffSession = vi.fn();
  return {
    requireStaffSession,
    requireShopSurface: vi.fn(async () => ({ session: await requireStaffSession() })),
  };
});
vi.mock("@/db/authz", () => ({
  canPersonConfigureTrips: vi.fn(async () => true),
  canPersonManageWaiverTemplates: vi.fn(async () => true),
}));
vi.mock("@/db/shops", () => ({ getShopById: vi.fn(async () => ({ currency: "USD" })) }));
vi.mock("@/db/media-deletions", () => ({ queueAndAttemptMediaDeletion: vi.fn() }));
vi.mock("@/lib/storage", () => ({ storeCourseImage: vi.fn() }));
vi.mock("@/db/shop-text-translations", () => ({
  readTranslations: vi.fn(async () => new Map()),
  saveTranslation: vi.fn(async () => "saved"),
}));
vi.mock("@/db/course-forms", () => ({
  courseFormListRefusal: vi.fn(async () => null),
  listCourseFormRequirements: vi.fn(async () => []),
  listCourseFormAgeBounds: vi.fn(async () => new Map()),
  setCourseFormRequirements: vi.fn(),
}));

const { revalidatePath } = await import("next/cache");
const { getCourseBySlug, pullCourseTemplateUpdates, setCourseVisibility, updateCourseContent } =
  await import("@/db/courses");
const { readTranslations, saveTranslation } = await import("@/db/shop-text-translations");
const { requireStaffSession } = await import("@/lib/session");
const { canPersonConfigureTrips, canPersonManageWaiverTemplates } = await import("@/db/authz");
const {
  courseFormListRefusal,
  listCourseFormAgeBounds,
  listCourseFormRequirements,
  setCourseFormRequirements,
} = await import("@/db/course-forms");
const { pullCourseTemplateUpdatesAction, saveCourseContentAction, setCourseVisibilityAction } =
  await import("./actions");

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
    heroImageUrl: null,
    galleryPhotos: [],
    learningMaterials: [],
  } as never);
  vi.mocked(updateCourseContent).mockResolvedValue({ ok: true } as never);
});

/** A course page as the editor posts it: every content field, valid and blank. */
function coursePage(fields: [string, string][] = []): FormData {
  const formData = new FormData();
  for (const [key, value] of [
    ["summary", "A first breath underwater."],
    ["overview", ""],
    ["durationText", ""],
    ["groupSizeText", ""],
    ["prerequisiteNote", ""],
    ["includes", ""],
    ["excludes", ""],
    ["scheduleDaysJson", "[]"],
    ["faqsJson", "[]"],
    ["price", ""],
    ["eLearningPrice", ""],
    ["privatePrice", ""],
    ...fields,
  ]) {
    formData.append(key, value);
  }
  return formData;
}

/** Where the editor's one Save sent the browser. */
async function savedTo(formData: FormData) {
  try {
    await saveCourseContentAction("blue-mantis", "open-water-diver", formData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

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

/**
 * **The forms a course asks for are saved by the editor's one Save** (visual
 * review 2026-10-24, A11). The section's own form and Save are gone; the page
 * posts `formsSection` with the list it drew, and a refused list refuses the
 * whole save before anything is written.
 */
describe("saveCourseContentAction, with the forms a course asks for", () => {
  const FORM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const FORM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const FORM_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

  async function posted(fields: [string, string][]) {
    return savedTo(coursePage([["formsSection", "1"], ...fields]));
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

    expect(to).toBe("/shop/blue-mantis/courses/open-water-diver/edit?notice=saved");
    expect(setCourseFormRequirements).toHaveBeenCalledWith(
      {},
      {
        shopId: SHOP_ID,
        courseId: COURSE_ID,
        formIds: [FORM_C, FORM_B, FORM_A],
        maxAgeYears: new Map(),
        mayNarrow: true,
      },
    );
  });

  it("saves the age under a ticked form, and refuses one that is not a whole number (issue 2265)", async () => {
    vi.mocked(setCourseFormRequirements).mockResolvedValue({ ok: true });

    await posted([
      ["formId", FORM_A],
      ["formId", FORM_B],
      [`maxAge-${FORM_A}`, " 11 "],
      [`maxAge-${FORM_B}`, ""],
      // An age under a form that is not ticked asks nothing of anyone.
      [`maxAge-${FORM_C}`, "9"],
    ]);
    expect(setCourseFormRequirements).toHaveBeenCalledWith(
      {},
      {
        shopId: SHOP_ID,
        courseId: COURSE_ID,
        formIds: [FORM_A, FORM_B],
        maxAgeYears: new Map([[FORM_A, 11]]),
        mayNarrow: true,
      },
    );
    vi.mocked(setCourseFormRequirements).mockClear();

    for (const age of ["eleven", "10.5", "-3"]) {
      expect(
        await posted([
          ["formId", FORM_A],
          [`maxAge-${FORM_A}`, age],
        ]),
      ).toBe("/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-invalid-age#forms");
    }
    expect(setCourseFormRequirements).not.toHaveBeenCalled();

    vi.mocked(setCourseFormRequirements).mockResolvedValue({ ok: false, reason: "invalid_age" });
    expect(
      await posted([
        ["formId", FORM_A],
        [`maxAge-${FORM_A}`, "0"],
      ]),
    ).toBe("/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-invalid-age#forms");
  });

  /**
   * **A forms list the database would refuse refuses the whole save first**
   * (dive-domain review, visual review 2026-10-24): the page's words and its
   * prices are written before the forms, so a refusal found only in the forms
   * write would land after them.
   */
  it("refuses a list naming a bound on a medical form before writing the page or its prices", async () => {
    const { updateCourse } = await import("@/db/courses");
    vi.mocked(updateCourse).mockClear();
    vi.mocked(updateCourseContent).mockClear();
    vi.mocked(setCourseFormRequirements).mockClear();
    vi.mocked(courseFormListRefusal).mockResolvedValueOnce("medical_bound");
    expect(
      await posted([
        ["formId", FORM_A],
        [`maxAge-${FORM_A}`, "12"],
      ]),
    ).toBe("/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-medical-age#forms");
    expect(updateCourseContent).not.toHaveBeenCalled();
    expect(updateCourse).not.toHaveBeenCalled();
    expect(setCourseFormRequirements).not.toHaveBeenCalled();
  });

  it("saves an empty list when nothing is ticked: the course asks for no forms", async () => {
    vi.mocked(setCourseFormRequirements).mockResolvedValue({ ok: true });

    await posted([]);

    expect(setCourseFormRequirements).toHaveBeenCalledWith(
      {},
      {
        shopId: SHOP_ID,
        courseId: COURSE_ID,
        formIds: [],
        maxAgeYears: new Map(),
        mayNarrow: true,
      },
    );
  });

  it("refuses a staffer who cannot configure trips, and writes nothing", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValueOnce(false);

    expect(await posted([["formId", FORM_A]])).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-not-authorized#forms",
    );
    expect(setCourseFormRequirements).not.toHaveBeenCalled();
    // The whole save is refused, the course page with it.
    expect(updateCourseContent).not.toHaveBeenCalled();
  });

  it("leaves the forms alone when the page drew no forms list", async () => {
    expect(await savedTo(coursePage())).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=saved",
    );
    expect(updateCourseContent).toHaveBeenCalled();
    expect(setCourseFormRequirements).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a uuid before it reaches the database", async () => {
    expect(await posted([["formId", "not-a-form"]])).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-invalid#forms",
    );
    expect(setCourseFormRequirements).not.toHaveBeenCalled();
  });

  it("lets an instructor add a form, but never take one off: that is an owner's or manager's call", async () => {
    vi.mocked(setCourseFormRequirements).mockResolvedValue({ ok: true });
    vi.mocked(canPersonManageWaiverTemplates).mockResolvedValue(false);
    vi.mocked(listCourseFormRequirements).mockResolvedValue([FORM_A]);

    // Adding B beside A saves.
    expect(
      await posted([
        ["formId", FORM_A],
        ["formId", FORM_B],
      ]),
    ).toBe("/shop/blue-mantis/courses/open-water-diver/edit?notice=saved");
    vi.mocked(setCourseFormRequirements).mockClear();

    // Dropping A — even while adding B — is refused, and writes nothing.
    expect(await posted([["formId", FORM_B]])).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-remove-not-authorized#forms",
    );
    expect(setCourseFormRequirements).not.toHaveBeenCalled();
    vi.mocked(canPersonManageWaiverTemplates).mockResolvedValue(true);
    vi.mocked(listCourseFormRequirements).mockResolvedValue([]);
  });

  it("lets an instructor raise or clear an age, never put one on or lower it (G1)", async () => {
    vi.mocked(setCourseFormRequirements).mockResolvedValue({ ok: true });
    vi.mocked(canPersonManageWaiverTemplates).mockResolvedValue(false);
    vi.mocked(listCourseFormRequirements).mockResolvedValue([FORM_A, FORM_B]);
    vi.mocked(listCourseFormAgeBounds).mockResolvedValue(new Map([[FORM_A, 11]]));
    const both = (ages: [string, string]) =>
      posted([
        ["formId", FORM_A],
        ["formId", FORM_B],
        [`maxAge-${FORM_A}`, ages[0]],
        [`maxAge-${FORM_B}`, ages[1]],
      ]);
    const refused =
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-remove-not-authorized#forms";

    // A bound on B, which asked everyone, and A lowered: each asks fewer students.
    expect(await both(["11", "12"])).toBe(refused);
    expect(await both(["10", ""])).toBe(refused);
    expect(setCourseFormRequirements).not.toHaveBeenCalled();
    // Raising A, or clearing it, asks more: theirs to do.
    expect(await both(["14", ""])).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=saved",
    );
    expect(setCourseFormRequirements).toHaveBeenLastCalledWith(
      {},
      expect.objectContaining({ mayNarrow: false }),
    );
    expect(await both(["", ""])).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=saved",
    );
    vi.mocked(canPersonManageWaiverTemplates).mockResolvedValue(true);
    vi.mocked(listCourseFormRequirements).mockResolvedValue([]);
    vi.mocked(listCourseFormAgeBounds).mockResolvedValue(new Map());
  });

  it("says so when an age is put on a medical statement (G3)", async () => {
    vi.mocked(setCourseFormRequirements).mockResolvedValue({ ok: false, reason: "medical_bound" });
    expect(
      await posted([
        ["formId", FORM_A],
        [`maxAge-${FORM_A}`, "11"],
      ]),
    ).toBe("/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-medical-age#forms");
  });

  it("says so when the list names a form that is not this shop's", async () => {
    vi.mocked(setCourseFormRequirements).mockResolvedValue({ ok: false, reason: "unknown_form" });

    expect(await posted([["formId", FORM_A]])).toBe(
      "/shop/blue-mantis/courses/open-water-diver/edit?notice=forms-invalid#forms",
    );
  });
});

/**
 * **The summary's Spanish rides the same Save** (visual review 2026-10-24,
 * A11): a refused box refuses the save before anything is written, and an
 * accepted one is written after the English it translates.
 */
describe("saveCourseContentAction, with the summary's Spanish", () => {
  it("writes typed Spanish once the course page is saved", async () => {
    expect(
      await savedTo(coursePage([["spanish.summary", "Tu primera respiración bajo el agua."]])),
    ).toBe("/shop/blue-mantis/courses/open-water-diver/edit?notice=saved");
    expect(updateCourseContent).toHaveBeenCalled();
    expect(saveTranslation).toHaveBeenCalledWith(
      {},
      SHOP_ID,
      { kind: "course", id: COURSE_ID, field: "summary" },
      expect.objectContaining({ text: "Tu primera respiración bajo el agua." }),
    );
  });

  it("refuses Spanish written from other English, and writes nothing", async () => {
    expect(
      await savedTo(
        coursePage([
          ["spanish.summary", "Hola"],
          ["spanishFrom.summary", "a-digest-of-other-english"],
        ]),
      ),
    ).toBe("/shop/blue-mantis/courses/open-water-diver/edit?error=spanish-stale");
    expect(updateCourseContent).not.toHaveBeenCalled();
    expect(saveTranslation).not.toHaveBeenCalled();
  });

  it("leaves Spanish nobody touched alone, whatever the English did", async () => {
    vi.mocked(readTranslations).mockResolvedValueOnce(
      new Map([[`${COURSE_ID}:summary`, { text: "Hola", sourceDigest: "old" }]]),
    );
    expect(
      await savedTo(
        coursePage([
          ["spanish.summary", "Hola"],
          ["spanishFrom.summary", "old"],
        ]),
      ),
    ).toBe("/shop/blue-mantis/courses/open-water-diver/edit?notice=saved");
    expect(saveTranslation).not.toHaveBeenCalled();
  });
});

/**
 * **"Is this course for sale" is trip-definition work** (H-20260724-staff-role-reach, ADR
 * 20260724-role-authorization). The page draws the toggle only for a reader
 * whose roles allow it (`page.authz.test.tsx`); this is the gate itself, since a
 * form that is not rendered is not a form that cannot be posted. It was an
 * inline closure in `page.tsx` until the 2026-10-11 review moved it here, and
 * these cases came with it.
 */
describe("setCourseVisibilityAction", () => {
  const ACTIVE_COURSE = { id: COURSE_ID, slug: "open-water-diver", isActive: true };

  beforeEach(() => {
    vi.mocked(getCourseBySlug).mockResolvedValue(ACTIVE_COURSE as never);
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(true);
  });

  it("flips the course in the session's shop and revalidates the editor and the roster", async () => {
    await setCourseVisibilityAction("open-water-diver", COURSE_ID);

    expect(getCourseBySlug).toHaveBeenCalledWith({}, SHOP_ID, "open-water-diver");
    expect(setCourseVisibility).toHaveBeenCalledWith({}, SHOP_ID, COURSE_ID, false);
    expect(revalidatePath).toHaveBeenCalledWith("/shop/blue-mantis/courses/open-water-diver/edit");
    expect(revalidatePath).toHaveBeenCalledWith("/shop/blue-mantis/courses");
  });

  /**
   * A tab opened while the reader still had the role, posted after it was taken
   * away. The action re-asks live roles and refuses; the row never moves.
   */
  it("refuses the post from a role that may not define trips", async () => {
    vi.mocked(canPersonConfigureTrips).mockResolvedValue(false);
    await expect(setCourseVisibilityAction("open-water-diver", COURSE_ID)).rejects.toThrow(
      "REDIRECT:/shop/blue-mantis/courses/open-water-diver/edit?error=not-authorized",
    );
    expect(setCourseVisibility).not.toHaveBeenCalled();
  });

  /**
   * **The live row decides the flip.** Binding the render's `isActive` meant a
   * tab left open while a colleague hid the course posted "hide it" again and
   * put it back on the diver-facing catalog.
   */
  it("flips the standing the row has now, not the one the page was rendered with", async () => {
    // Somebody else hid it between the render and the tap.
    vi.mocked(getCourseBySlug).mockResolvedValue({ ...ACTIVE_COURSE, isActive: false } as never);
    await setCourseVisibilityAction("open-water-diver", COURSE_ID);

    expect(setCourseVisibility).toHaveBeenCalledWith({}, SHOP_ID, COURSE_ID, true);
  });

  /**
   * A slug that no longer names the course the page was rendered for, or a
   * bound id edited on the way through the client: either way the pair no
   * longer agrees, and nothing is toggled.
   */
  it("refuses when the slug and the bound id no longer name the same course", async () => {
    vi.mocked(getCourseBySlug).mockResolvedValue({ ...ACTIVE_COURSE, id: "other-course" } as never);
    await expect(setCourseVisibilityAction("open-water-diver", COURSE_ID)).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(setCourseVisibility).not.toHaveBeenCalled();
  });

  it("refuses a slug this shop has no course under", async () => {
    vi.mocked(getCourseBySlug).mockResolvedValue(null as never);
    await expect(setCourseVisibilityAction("someone-elses", COURSE_ID)).rejects.toThrow(
      "NOT_FOUND",
    );
    expect(setCourseVisibility).not.toHaveBeenCalled();
  });
});
