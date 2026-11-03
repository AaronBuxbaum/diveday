// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BookableDiver } from "@/db/divers";
import type { DateInterestRow } from "@/db/interest-dates";
import { staffTranslator } from "@/i18n/staff-messages";
import { seatRequestBand } from "./seat-request-band";

afterEach(cleanup);

const t = staffTranslator("en-US");
const ROW = {
  id: "6f1c2c9e-1111-4000-8000-000000000001",
  courseId: null,
  courseTitle: null,
  interest: "Wreck",
  personId: null,
  name: "Imani Okafor",
  email: "imani@example.com",
  phone: "+13055550101",
  partySize: 3,
} as DateInterestRow;

describe("seatRequestBand", () => {
  it("prefills someone not on file and names who asked, for how many", () => {
    const band = seatRequestBand({ row: ROW, candidate: null }, { shopSlug: "blue-mantis", t });
    expect(band.context).toEqual({
      id: ROW.id,
      prefill: { fullName: "Imani Okafor", email: "imani@example.com", phone: "+13055550101" },
    });
    expect(band.search).toBeUndefined();
    render(<div>{band.card}</div>);
    expect(screen.getByText(t("bookings.new.fromRequest"))).toBeInTheDocument();
    expect(screen.getByText(`(${t("requests.divers", { count: 3 })})`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: t("bookings.new.viewRequests") })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/requests",
    );
  });

  it("offers the asker on file as the one match, and prefills nothing", () => {
    const candidate = {
      person: { id: "person-1", fullName: "Avery Diver" },
      rentalFit: null,
    } as unknown as BookableDiver;
    const band = seatRequestBand(
      { row: { ...ROW, personId: "person-1", name: "Avery Diver" }, candidate },
      { shopSlug: "blue-mantis", t },
    );
    expect(band.context).toEqual({ id: ROW.id, prefill: undefined });
    expect(band.search).toEqual({ query: "Avery Diver", candidates: [candidate] });
    render(<div>{band.card}</div>);
    expect(screen.getByRole("link", { name: t("requests.viewDiver") })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/person-1",
    );
  });
});
