import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireStaffSession: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: vi.fn() }));

const { requireStaffSession } = await import("@/lib/session");
const { log } = await import("@/lib/log");
const { reportAgencyCheckPageAction } = await import("./agency-check-report");
const { RATE_LIMITS } = await import("@/lib/rate-limit");

/**
 * A failed check's report: one log line, from a signed-in staffer, and never
 * more of them than a person checking cards could send (security review R7 1).
 */
function post(): FormData {
  const formData = new FormData();
  formData.set("agency", "ssi");
  formData.set("reason", "timeout");
  formData.set("version", "1.5.0");
  return formData;
}

function signIn(personId: string, shopId: string) {
  vi.mocked(requireStaffSession).mockResolvedValue({
    user: { shopId, personId, roles: ["owner"] },
  } as never);
}

afterEach(() => {
  vi.mocked(log).mockClear();
});

describe("reportAgencyCheckPageAction", () => {
  it("logs one line per report, and stops logging a staffer past their hour's allowance", async () => {
    signIn("person-report-a", "shop-report-a");
    const allowance = RATE_LIMITS.agencyCheckReportByPerson.capacity;
    for (let sent = 0; sent < allowance + 1; sent += 1) {
      await reportAgencyCheckPageAction(post());
    }
    expect(log).toHaveBeenCalledTimes(allowance);
    expect(log).toHaveBeenLastCalledWith(
      "agency_check.page_shape",
      "warn",
      expect.objectContaining({ shopId: "shop-report-a", agency: "ssi", reason: "timeout" }),
    );

    // Another staffer at another shop still reports.
    signIn("person-report-b", "shop-report-b");
    await reportAgencyCheckPageAction(post());
    expect(log).toHaveBeenCalledTimes(allowance + 1);
  });

  it("stops logging a shop past its hour's allowance, whichever staffer sends", async () => {
    const allowance = RATE_LIMITS.agencyCheckReportByShop.capacity;
    for (let sent = 0; sent < allowance + 1; sent += 1) {
      signIn(`person-shop-c-${sent}`, "shop-report-c");
      await reportAgencyCheckPageAction(post());
    }
    expect(log).toHaveBeenCalledTimes(allowance);
  });
});
