// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadyPageData } from "@/db/ready";
import { ReadyFitForm } from "./ReadyFitForm";

const seen = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock("../gear-actions", () => ({ saveFitFromReady: async () => {} }));
vi.mock("@/app/s/[shopSlug]/trips/[id]/_components/RentalFitForm", () => ({
  RentalFitForm: (props: Record<string, unknown>) => {
    seen.props = props;
    return <form />;
  },
}));

afterEach(cleanup);

describe("ReadyFitForm", () => {
  it("hands the trip page's form this seat's items, the shop's currency and the save state", () => {
    const data = {
      rentalFit: null,
      trip: { course: null, plannedDives: 2 },
      shop: { rentalPricing: {}, currency: "usd" },
      wantsNitrox: false,
      nitroxCardVerified: false,
      nitroxCardOnFile: true,
    } as unknown as ReadyPageData;
    render(
      <ReadyFitForm
        token="tok"
        data={data}
        seatItems={["fins", "mask"]}
        nitroxCardEntryOffered={false}
        saved
      />,
    );
    expect(seen.props).toMatchObject({
      rentalItems: ["fins", "mask"],
      currency: "usd",
      plannedDives: 2,
      nitroxCardOnFile: true,
      nitroxCardEntryOffered: false,
      saved: true,
    });
    expect(typeof seen.props?.action).toBe("function");
  });
});
