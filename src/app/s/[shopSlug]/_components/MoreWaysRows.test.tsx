// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { MoreWaysRows } from "./MoreWaysRows";

vi.mock("@/app/actions/inquiry", () => ({ submitInquiryAction: async () => {} }));
vi.mock("@/i18n/DiverIntlProvider", () => ({
  DiverIntlProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/DateRequestForm", () => ({ DateRequestForm: () => <li>date-request</li> }));
vi.mock("./LastMinuteListForm", () => ({ LastMinuteListForm: () => <li>deal-list</li> }));
vi.mock("./FindMyBookingForm", () => ({ FindMyBookingForm: () => <li>find-booking</li> }));

const t = diverTranslator("en-US");

afterEach(cleanup);

function show(over: Partial<React.ComponentProps<typeof MoreWaysRows>> = {}) {
  render(
    <MoreWaysRows
      shopSlug="blue-mantis"
      quiet={false}
      dateRequestsEnabled
      lastMinuteListEnabled
      everHadDeparture
      locale="en-US"
      tz="America/New_York"
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

  it("offers no deal list or booking finder to a shop that never ran a departure", () => {
    show({ everHadDeparture: false });
    expect(screen.queryByText("deal-list")).toBeNull();
    expect(screen.queryByText("find-booking")).toBeNull();
  });

  it("drops the deal list a shop switched off", () => {
    show({ lastMinuteListEnabled: false });
    expect(screen.queryByText("deal-list")).toBeNull();
    expect(screen.getByText("find-booking")).toBeTruthy();
  });
});
