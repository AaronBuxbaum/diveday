// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadyPageData } from "@/db/ready";
import { diverTranslator } from "@/i18n/messages";
import { ReadyMasthead } from "./ReadyMasthead";

const seen = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));

vi.mock("@/app/s/[shopSlug]/trips/[id]/_components/TripActions", () => ({
  TripActions: (props: Record<string, unknown>) => {
    seen.props = props;
    return null;
  },
}));

const t = diverTranslator("en-US");

afterEach(cleanup);

function data(over: Partial<ReadyPageData> = {}): ReadyPageData {
  return {
    detail: {
      trip: {
        startsAt: new Date("2026-07-25T12:00:00Z"),
        endsAt: new Date("2026-07-25T16:00:00Z"),
      },
      shop: { timezone: "America/New_York" },
    },
    shop: { slug: "blue-mantis", dockCallMinutes: 30 },
    trip: { id: "11111111-1111-4111-8111-111111111111" },
    pickupTime: null,
    hotelPickupLocation: null,
    ...over,
  } as unknown as ReadyPageData;
}

describe("ReadyMasthead", () => {
  it("names the dock call half an hour ahead, in the shop's zone", () => {
    render(<ReadyMasthead data={data()} locale="en-US" t={t} diveDay={false} />);
    expect(screen.getByText(/7:30/)).toBeTruthy();
    expect(screen.queryByText(t("thread.diveDayLine"))).toBeNull();
    expect(screen.getByText(t("ready.keepThisPage"))).toBeTruthy();
  });

  it("leads with the hotel pickup when one is scheduled", () => {
    render(
      <ReadyMasthead
        data={data({ pickupTime: "7:00 AM", hotelPickupLocation: "Pier House" } as never)}
        locale="en-US"
        t={t}
        diveDay
      />,
    );
    expect(screen.getByText(/Pier House/)).toBeTruthy();
    expect(screen.queryByText(/7:30/)).toBeNull();
    expect(screen.getByText(t("thread.diveDayLine"))).toBeTruthy();
  });

  it("shares the public trip page, never this bearer page", () => {
    render(<ReadyMasthead data={data()} locale="en-US" t={t} diveDay={false} />);
    expect(String(seen.props?.shareUrl)).toContain(
      "/s/blue-mantis/trips/11111111-1111-4111-8111-111111111111",
    );
    expect(String(seen.props?.shareUrl)).not.toContain("/ready/");
  });
});
