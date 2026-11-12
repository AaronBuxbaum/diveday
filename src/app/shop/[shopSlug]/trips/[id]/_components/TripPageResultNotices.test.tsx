import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/features/trip-page", () => ({ getTripPersonClashes: read }));
const { TripPageResultNotices } = await import("./TripPageResultNotices");

it("offers a retry when the all-leg review cannot get the schedule lock", async () => {
  read.mockRejectedValue(Object.assign(new Error("lock wait"), { code: "55P03" }));
  const node = await TripPageResultNotices({
    db: {} as never,
    rootPageNotice: undefined,
    rest: { clashes: "1" },
    shop: { id: "shop", timezone: "UTC" },
    trip: {
      id: "3f03346a-f1c6-4437-9217-a71a837d7df9",
      startsAt: new Date("2035-08-04T08:00:00Z"),
    },
    shopSlug: "reef",
    locale: "en-US",
  });
  const html = renderToStaticMarkup(node);
  expect(html).toContain("The schedule is busy");
  expect(html).toContain("clashes=1");
  expect(html).not.toContain("No current conflicts");
});

it("does not disguise unrelated review failures as contention", async () => {
  read.mockRejectedValue(new Error("unexpected"));
  await expect(
    TripPageResultNotices({
      db: {} as never,
      rootPageNotice: undefined,
      rest: { clashes: "1" },
      shop: { id: "shop", timezone: "UTC" },
      trip: {
        id: "3f03346a-f1c6-4437-9217-a71a837d7df9",
        startsAt: new Date("2035-08-04T08:00:00Z"),
      },
      shopSlug: "reef",
      locale: "en-US",
    }),
  ).rejects.toThrow("unexpected");
});
