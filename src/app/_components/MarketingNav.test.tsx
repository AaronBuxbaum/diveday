import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiverLocale } from "@/i18n/settings";

const auth = vi.fn();
const requestLocale = vi.fn<() => Promise<DiverLocale>>();

vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
vi.mock("@/i18n/request", () => ({ requestLocale: () => requestLocale() }));
vi.mock("@/app/actions/demo", () => ({ enterDemoAction: async () => {} }));

const { MarketingNav } = await import("./MarketingNav");

function pendingSession() {
  let resolve: (value: unknown) => void = () => {};
  auth.mockReturnValue(
    new Promise((settle) => {
      resolve = settle;
    }),
  );
  return (value: unknown) => resolve(value);
}

beforeEach(() => {
  auth.mockReset();
  requestLocale.mockReset();
  requestLocale.mockResolvedValue("es-ES");
});

describe("MarketingNav", () => {
  it("reads the locale before the session answers, not after it", async () => {
    const answerSession = pendingSession();
    const nav = MarketingNav();
    // The session's database read is still out: a cookies() read queued
    // behind it is the one Next refused once the response had closed.
    expect(requestLocale).toHaveBeenCalledTimes(1);
    answerSession({ user: { shopSlug: "blue-mantis" } });
    const element = await nav;
    expect(element.props).toMatchObject({ shopSlug: "blue-mantis", locale: "es-ES" });
  });

  it("reads no request locale when its caller already negotiated one", async () => {
    const answerSession = pendingSession();
    const nav = MarketingNav({ locale: "en-US" });
    answerSession(null);
    const element = await nav;
    expect(requestLocale).not.toHaveBeenCalled();
    expect(element.props).toMatchObject({ shopSlug: null, locale: "en-US" });
  });
});
