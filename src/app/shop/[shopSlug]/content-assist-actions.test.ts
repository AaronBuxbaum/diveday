import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A course's Spanish summary is part of the template, so saving or drafting it
 * takes the template gate (`canEditCourseTemplates`), never a bare staff
 * session: a divemaster cannot rewrite the words a diver reads by posting the
 * save directly.
 */

vi.mock("@/features/session", () => ({ requireShopSurface: vi.fn() }));
vi.mock("@/db/authz", () => ({
  canPersonConfigureTrips: vi.fn(),
  canPersonEditCourseTemplates: vi.fn(),
}));
vi.mock("@/db/shop-text-translations", () => ({
  recordTranslation: vi.fn(),
  translatableOriginal: vi.fn(async () => "English words"),
}));

const { requireShopSurface } = await import("@/features/session");
const { canPersonEditCourseTemplates } = await import("@/db/authz");
const { recordTranslation } = await import("@/db/shop-text-translations");
const { saveTranslationAction } = await import("./content-assist-actions");

const COURSE_ID = "11111111-1111-4111-8111-111111111111";

describe("saveTranslationAction on a course", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireShopSurface).mockRejectedValue(new Error("REFUSED"));
  });

  it("asks the course-template gate, and writes nothing when it refuses", async () => {
    const form = new FormData();
    form.set("text", "Resumen");
    await expect(
      saveTranslationAction("blue-mantis", "course", COURSE_ID, "summary", {}, form),
    ).rejects.toThrow("REFUSED");
    expect(vi.mocked(requireShopSurface).mock.calls[0]?.[1]).toMatchObject({
      allow: canPersonEditCourseTemplates,
      refusal: { landing: ["courses"] },
    });
    expect(recordTranslation).not.toHaveBeenCalled();
  });
});
