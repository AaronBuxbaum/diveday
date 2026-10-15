// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";

const liveReleaseIsSample = vi.fn();
vi.mock("@/db/first-run", () => ({ liveReleaseIsSample: () => liveReleaseIsSample() }));

const { ReleaseStillSample } = await import("./ReleaseStillSample");

afterEach(cleanup);
const t = staffTranslator("en-US");
const shop = { id: "shop-1", slug: "blue-mantis", isDemo: false };
const db = {} as never;

async function rendered(props: Partial<Parameters<typeof ReleaseStillSample>[0]> = {}) {
  const element = await ReleaseStillSample({
    db,
    shop,
    roles: ["owner"],
    firstRun: false,
    t,
    ...props,
  });
  return element ? render(element) : null;
}

/** "Read your release" outlives first run (fourth UX review, item 21). */
describe("the standing release row", () => {
  it("stands on Today while divers sign the sample, as a door to the release", async () => {
    liveReleaseIsSample.mockResolvedValue(true);
    await rendered();
    expect(screen.getByRole("link", { name: "Read the release" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/waivers#release",
    );
  });

  it("goes once the shop's own words are live", async () => {
    liveReleaseIsSample.mockResolvedValue(false);
    expect(await rendered()).toBeNull();
  });

  it("is not drawn for crew who may not edit the release, on a demo, or beside the checklist", async () => {
    liveReleaseIsSample.mockResolvedValue(true);
    expect(await rendered({ roles: ["divemaster"] })).toBeNull();
    expect(await rendered({ shop: { ...shop, isDemo: true } })).toBeNull();
    expect(await rendered({ firstRun: true })).toBeNull();
  });
});
