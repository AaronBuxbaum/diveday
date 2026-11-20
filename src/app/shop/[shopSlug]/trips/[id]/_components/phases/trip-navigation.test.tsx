import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { ReadyPhase } from "./ReadyPhase";
import { WrappedRecordLinks } from "./WrappedRecordLinks";

const t = staffTranslator("en-US");

describe("trip navigation", () => {
  it("takes paper passes to the existing Check-in eligibility controls", () => {
    const html = renderToStaticMarkup(
      <ReadyPhase
        record={{ context: { shop: { slug: "blue-mantis" } }, tripId: "trip-1", t } as never}
        deskOpen
        guests={null}
        prep={null}
        buddies={null}
      />,
    );
    expect(html).toContain("/shop/blue-mantis/trips/trip-1?phase=checkin");
    expect(html).toContain("arrived and cleared guests");
    expect(html).not.toContain("?pass=");
    const closed = renderToStaticMarkup(
      <ReadyPhase
        record={{ context: { shop: { slug: "blue-mantis" } }, tripId: "trip-1", t } as never}
        deskOpen={false}
        guests={null}
        prep={null}
        buddies={null}
      />,
    );
    expect(closed).not.toContain("?phase=checkin");
    expect(closed).toContain(t("trips.clock.ready.paperPassesUnavailable"));
  });
  it("links only enabled records and existing dive logs", () => {
    const html = renderToStaticMarkup(
      <WrappedRecordLinks
        shopSlug="blue-mantis"
        tripId="trip-1"
        sightingDives={[1]}
        dives={[1, 3]}
        sightingsEnabled
        lostFoundEnabled
        t={t}
      />,
    );
    expect(html).toContain("#dive-log-1-executed-dive");
    expect(html).toContain("#dive-log-3-executed-dive");
    expect(html).not.toContain("#dive-log-2-executed-dive");
    expect(html).toContain(
      "/shop/blue-mantis/trips/trip-1/manifest?checkpoint=after_dive_1#seen-heading",
    );
    expect(html).toContain("#found-aboard");
    expect(
      renderToStaticMarkup(
        <WrappedRecordLinks
          shopSlug="blue-mantis"
          tripId="trip-1"
          sightingDives={[1]}
          dives={[1]}
          sightingsEnabled={false}
          lostFoundEnabled={false}
          t={t}
        />,
      ),
    ).toBe("");
  });
});
