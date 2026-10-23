// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { MoreWaysRows } from "./MoreWaysRows";

vi.mock("@/app/actions/inquiry", () => ({ submitInquiryAction: async () => {} }));
vi.mock("@/components/DateRequestForm", () => ({ DateRequestForm: () => <li>date-request</li> }));
vi.mock("./LastMinuteListForm", () => ({
  LastMinuteListForm: ({ waitlistOn }: { waitlistOn: boolean }) => (
    <li>{waitlistOn ? "deal-list" : "deal-list-no-wait-list"}</li>
  ),
}));
vi.mock("./FindMyBookingForm", () => ({ FindMyBookingForm: () => <li>find-booking</li> }));

const t = diverTranslator("en-US");

afterEach(cleanup);

const ALL_ON = { dateRequestsEnabled: true, lastMinuteListEnabled: true, waitlistEnabled: true };

function show(
  over: Partial<React.ComponentProps<typeof MoreWaysRows>> = {},
  switches: Partial<typeof ALL_ON> = {},
) {
  render(
    <MoreWaysRows
      shopSlug="blue-mantis"
      quiet={false}
      promotedAsk={false}
      switches={{ ...ALL_ON, ...switches }}
      everHadDeparture
      t={t}
      {...over}
    />,
  );
}

describe("MoreWaysRows", () => {
  it("offers the date request, the deal list and the booking finder, in that order", () => {
    show();
    const text = document.body.textContent ?? "";
    expect(text.indexOf("date-request")).toBeLessThan(text.indexOf("deal-list"));
    expect(text.indexOf("deal-list")).toBeLessThan(text.indexOf("find-booking"));
  });

  it("leaves the date request to the off-season card when it is up", () => {
    show({ quiet: true });
    expect(screen.queryByText("date-request")).toBeNull();
  });

  it("leaves the date request to the board's-end ask when the runs keep going", () => {
    show({ promotedAsk: true });
    expect(screen.queryByText("date-request")).toBeNull();
  });

  it("offers no deal list or booking finder to a shop that never ran a departure", () => {
    show({ everHadDeparture: false });
    expect(screen.queryByText("deal-list")).toBeNull();
    expect(screen.queryByText("find-booking")).toBeNull();
  });

  it("drops the deal list a shop switched off", () => {
    show({}, { lastMinuteListEnabled: false });
    expect(screen.queryByText("deal-list")).toBeNull();
    expect(screen.getByText("find-booking")).toBeTruthy();
  });

  it("points the deal list at no trip's wait list while the wait list is off", () => {
    show({}, { waitlistEnabled: false });
    expect(screen.getByText("deal-list-no-wait-list")).toBeTruthy();
  });
});
