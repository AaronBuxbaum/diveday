import { beforeEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import {
  SELF_DECLARED_AGENCIES,
  SELF_DECLARED_LEVELS,
  SELF_REGISTRATION_DONE,
} from "@/lib/self-registration";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/shops", () => ({
  getShopBySlug: vi.fn(async () => ({ id: "shop", selfRegistrationEnabled: true })),
}));
vi.mock("@/db/self-registration", () => ({
  registerDiverAtShop: vi.fn(async () => ({ personId: "person" })),
  deliverSelfRegistrationWaiver: vi.fn(),
}));
vi.mock("@/i18n/request", () => ({ requestLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/self-registration-delivery", () => ({
  selfRegistrationReleaseDelivery: vi.fn(async () => "send"),
}));
vi.mock("@/lib/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));
const { registerAtShopAction } = await import("./actions");
const { registerDiverAtShop } = await import("@/db/self-registration");
const t = diverTranslator("en-US");
beforeEach(() => vi.clearAllMocks());
function form(agency = "") {
  const data = new FormData();
  data.set("fullName", "Walk In");
  data.set("email", "walk.in@example.test");
  data.set("agency", agency);
  return data;
}
describe("registration certification boundary", () => {
  it.each(["open_water", "forged-level", ""])(
    "ignores stale uncertified level %s and an oversized number",
    async (level) => {
      const data = form();
      data.set("level", level);
      data.set("identifier", "x".repeat(121));
      expect(await registerAtShopAction("reef", {}, data)).toEqual({
        status: SELF_REGISTRATION_DONE,
      });
      expect(registerDiverAtShop).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ certification: undefined }),
      );
    },
  );
  it("ignores duplicated fields and files only when agency is explicitly absent", async () => {
    const data = form();
    data.append("level", "forged");
    data.append("level", "rescue");
    data.set("identifier", new File(["x"], "stale.txt"));
    expect(await registerAtShopAction("reef", {}, data)).toEqual({
      status: SELF_REGISTRATION_DONE,
    });
    expect(registerDiverAtShop).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ certification: undefined }),
    );
  });
  it.each(SELF_DECLARED_AGENCIES)(
    "accepts the existing supported agency %s as a declaration",
    async (agency) => {
      const data = form(agency);
      data.set("level", "open_water");
      expect(await registerAtShopAction("reef", {}, data)).toEqual({
        status: SELF_REGISTRATION_DONE,
      });
      expect(registerDiverAtShop).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          certification: { agency, level: "open_water", identifier: undefined },
        }),
      );
    },
  );
  it.each(SELF_DECLARED_LEVELS)(
    "preserves normalized level %s and the optional declared number",
    async (level) => {
      const data = form("padi");
      data.set("level", level);
      data.set("identifier", "  P-123  ");
      expect(await registerAtShopAction("reef", {}, data)).toEqual({
        status: SELF_REGISTRATION_DONE,
      });
      expect(registerDiverAtShop).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ certification: { agency: "padi", level, identifier: "P-123" } }),
      );
    },
  );
  it.each(["nss_cds", "nacd", "forged"])(
    "refuses unsupported agency %s before ignoring other fields",
    async (agency) => {
      const data = form(agency);
      expect(await registerAtShopAction("reef", {}, data)).toEqual({
        error: t("register.invalid"),
      });
      expect(registerDiverAtShop).not.toHaveBeenCalled();
    },
  );
  it.each(["level", "identifier"])(
    "still validates %s for a selected supported agency",
    async (field) => {
      const data = form("padi");
      data.set("level", "open_water");
      data.set(field, "x".repeat(121));
      expect(await registerAtShopAction("reef", {}, data)).toEqual({
        error: t("register.invalid"),
      });
      expect(registerDiverAtShop).not.toHaveBeenCalled();
    },
  );
  it("keeps the existing agency-only behavior", async () => {
    expect(await registerAtShopAction("reef", {}, form("padi"))).toEqual({
      status: SELF_REGISTRATION_DONE,
    });
    expect(registerDiverAtShop).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ certification: undefined }),
    );
  });
  it("preserves first-entry parsing when a repeated agency starts blank", async () => {
    const data = form();
    data.append("agency", "padi");
    data.set("level", "forged");
    data.set("identifier", "x".repeat(121));
    expect(await registerAtShopAction("reef", {}, data)).toEqual({
      status: SELF_REGISTRATION_DONE,
    });
    expect(registerDiverAtShop).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ certification: undefined }),
    );
  });
  it.each(["forged", new File(["x"], "agency.txt")])(
    "refuses an invalid first agency even when the next entry is blank: %s",
    async (agency) => {
      const data = form();
      data.set("agency", agency);
      data.append("agency", "");
      expect(await registerAtShopAction("reef", {}, data)).toEqual({
        error: t("register.invalid"),
      });
      expect(registerDiverAtShop).not.toHaveBeenCalled();
    },
  );
});
