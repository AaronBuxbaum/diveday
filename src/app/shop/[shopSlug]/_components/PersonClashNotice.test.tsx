import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { sealPersonClashResult } from "@/features/person-clash-result";
import { PersonClashNotice } from "./PersonClashNotice";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("shows the transaction's named conflict in Spanish and rejects another shop", () => {
  const tripId = "3f03346a-f1c6-4437-9217-a71a837d7df9";
  const token = sealPersonClashResult("shop", tripId, [
    { personName: "Ana", otherTitle: "Arrecife" },
  ]);
  const props = {
    token,
    shopId: "shop",
    tripId,
    shopSlug: "buceo",
    day: "2035-08-04",
    locale: "es-ES",
  };
  expect(renderToStaticMarkup(<PersonClashNotice {...props} />)).toContain(
    "Ana también está en Arrecife.",
  );
  const foreign = renderToStaticMarkup(<PersonClashNotice {...props} shopId="other" />);
  expect(foreign).not.toContain("Ana");
  expect(foreign).toContain("revisa los conflictos actuales");
});

it("keeps a review warning if an authentic result expires", () => {
  vi.stubEnv("DIVEDAY_CLOCK", "");
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  const tripId = "3f03346a-f1c6-4437-9217-a71a837d7df9";
  const token = sealPersonClashResult("shop", tripId, [{ personName: "Ana", otherTitle: "Reef" }]);
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_121_000);
  const html = renderToStaticMarkup(
    <PersonClashNotice
      token={token}
      shopId="shop"
      tripId={tripId}
      shopSlug="reef"
      locale="en-US"
    />,
  );
  expect(html).toContain("review current conflicts");
  expect(html).toContain(`/shop/reef/trips/${tripId}?view=details&amp;clashes=1`);
  expect(html).not.toContain("Ana");
});

it("links overflow to all departure legs instead of a single day", () => {
  const tripId = "3f03346a-f1c6-4437-9217-a71a837d7df9";
  const token = sealPersonClashResult(
    "shop",
    tripId,
    Array.from({ length: 100 }, (_, i) => ({
      personName: `Diver ${i}`.repeat(20),
      otherTitle: "Reef".repeat(20),
    })),
  );
  const html = renderToStaticMarkup(
    <PersonClashNotice
      token={token}
      shopId="shop"
      tripId={tripId}
      shopSlug="reef"
      locale="en-US"
    />,
  );
  expect(html).toContain(`/shop/reef/trips/${tripId}?view=details&amp;clashes=1`);
  expect(html).toContain("more conflict");
});
