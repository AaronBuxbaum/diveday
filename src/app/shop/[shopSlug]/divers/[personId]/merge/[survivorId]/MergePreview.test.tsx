// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiverMergePreview, DiverMergeSide } from "@/db/diver-merge";
import { staffTranslator } from "@/i18n/staff-messages";
import { MergePreview } from "./MergePreview";

vi.mock("../../actions", () => ({
  mergeDiverAction: Object.assign(() => {}, { bind: () => () => {} }),
}));

afterEach(cleanup);

const t = staffTranslator("en-US");
const zeroCounts = {
  bookings: 0,
  releases: 0,
  cards: 0,
  orders: 0,
  notes: 0,
  messages: 0,
  reviews: 0,
  gear: 0,
  history: 0,
  lists: 0,
};

function side(overrides: Partial<DiverMergeSide>): DiverMergeSide {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    fullName: "Maya Rivera",
    email: null,
    phone: null,
    dateOfBirth: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    rentalFit: null,
    counts: zeroCounts,
    medicalAnswers: 0,
    medical: { openMedicalHold: false, declinedClearance: false },
    createdAt: new Date("2026-03-03T15:00:00.000Z"),
    ...overrides,
  };
}

function preview(overrides: Partial<DiverMergePreview> = {}): DiverMergePreview {
  return {
    source: side({
      phone: "+13055550142",
      counts: { ...zeroCounts, bookings: 2, releases: 1 },
      medicalAnswers: 1,
    }),
    survivor: side({
      id: "22222222-2222-4222-8222-222222222222",
      fullName: "Maya R. Rivera",
      phone: "+17865550199",
      email: "maya@example.com",
    }),
    conflicts: ["fullName", "phone"],
    refusal: null,
    sharedDepartures: [],
    warnings: [],
    releaseNames: [],
    acknowledgement: "",
    ...overrides,
  };
}

function renderPreview(value: DiverMergePreview) {
  return render(
    <MergePreview
      preview={value}
      shopSlug="blue-mantis"
      locale="en-US"
      timeZone="America/New_York"
      t={t}
    />,
  );
}

describe("the merge preview", () => {
  it("makes each disagreeing field a choice, the kept record's value preselected", () => {
    renderPreview(preview());
    const keepKept = screen.getByRole("radio", { name: /^Keep \+1\s786\s555\s0199$/ });
    const keepAway = screen.getByRole("radio", { name: /^Keep \+1\s305\s555\s0142$/ });
    expect(keepKept).toBeChecked();
    expect(keepAway).not.toBeChecked();
    expect(keepAway).toHaveAttribute("name", "keep_phone");
    expect(keepAway).toHaveAttribute("value", "source");
    // A field only one record holds is shown, not asked about.
    expect(screen.getByText("maya@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /maya@example\.com/ })).toBeNull();
  });

  it("counts what moves, medical answers included, and leaves empty groups out", () => {
    renderPreview(preview());
    const bookings = screen.getByRole("rowheader", { name: "Bookings" }).closest("tr");
    expect(
      within(bookings as HTMLElement)
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["2", "0"]);
    expect(screen.getByRole("rowheader", { name: "Medical answers" })).toBeInTheDocument();
    expect(screen.queryByRole("rowheader", { name: "Staff notes" })).toBeNull();
  });

  it("offers the swap and one danger button naming the kept record", () => {
    renderPreview(preview());
    expect(screen.getByRole("link", { name: "Keep Maya Rivera instead" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/divers/22222222-2222-4222-8222-222222222222/merge/11111111-1111-4111-8111-111111111111",
    );
    expect(screen.getByRole("button", { name: "Merge into Maya R. Rivera" })).toBeInTheDocument();
  });

  it("names the shared departure and offers no button when both sit on it", () => {
    renderPreview(
      preview({
        refusal: "booking_conflict",
        sharedDepartures: [
          {
            tripId: "33333333-3333-4333-8333-333333333333",
            title: "Two-Tank Reef",
            startsAt: new Date("2026-10-10T12:00:00.000Z"),
            keptSeatOver: false,
          },
        ],
      }),
    );
    expect(screen.getByText(/Both records hold a seat on the same departure/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Two-Tank Reef/ })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/trips/33333333-3333-4333-8333-333333333333",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("never asks staff to resolve a seat that is already cancelled (issue #2177)", () => {
    renderPreview(
      preview({
        refusal: "booking_conflict",
        sharedDepartures: [
          {
            tripId: "33333333-3333-4333-8333-333333333333",
            title: "Two-Tank Reef",
            startsAt: new Date("2026-10-10T12:00:00.000Z"),
            keptSeatOver: true,
          },
        ],
      }),
    );
    expect(screen.queryByText(/Both records hold a seat/)).toBeNull();
    expect(screen.getByText(/The kept record’s seat on this departure is canceled/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Two-Tank Reef/ })).toBeVisible();
    // The way out is the swap the page already offers.
    expect(screen.getByRole("link", { name: "Keep Maya Rivera instead" })).toBeVisible();
  });

  it("asks for a required acknowledgement when the two may be two people", () => {
    renderPreview(
      preview({
        warnings: [
          "different_birth_dates",
          "birth_date_unknown_on_one_record",
          "releases_under_different_names",
        ],
        releaseNames: ["Maya Rivera", "Carmen Diaz"],
        acknowledgement: "read-these-three",
      }),
    );
    expect(screen.getByRole("heading", { name: "These may be two people" })).toBeVisible();
    expect(screen.getByText(/Maya Rivera · Carmen Diaz/)).toBeVisible();
    expect(screen.getByText(/Only one record has a date of birth/)).toBeVisible();
    const box = screen.getByRole("checkbox", {
      name: "I confirmed with the diver (or their ID) that these records are one person.",
    });
    expect(box).toBeRequired();
    // The box posts the exact warnings it was ticked for, never a bare "yes".
    expect(box).toHaveAttribute("name", "acknowledgement");
    expect(box).toHaveAttribute("value", "read-these-three");
  });

  it("says a medical answer still open on a side, in danger tone, and asks about it", () => {
    renderPreview(
      preview({
        source: side({ medical: { openMedicalHold: true, declinedClearance: false } }),
        warnings: ["open_medical_hold"],
      }),
    );
    const flag = screen.getByText(
      "A medical answer on this record still needs a physician’s sign-off.",
    );
    expect(flag).toHaveClass("text-danger");
    expect(screen.getByText(/A medical answer is still waiting on a physician/)).toBeVisible();
    expect(screen.getByRole("checkbox")).toBeRequired();
  });

  it("warns under the date choice that a minor's date decides who must co-sign", () => {
    renderPreview(
      preview({
        source: side({ dateOfBirth: "2015-03-01" }),
        survivor: side({ id: "22222222-2222-4222-8222-222222222222", dateOfBirth: "1984-06-12" }),
        conflicts: ["dateOfBirth"],
        warnings: ["different_birth_dates"],
      }),
    );
    expect(
      screen.getByText(
        "The date you keep decides which releases need a parent or guardian’s signature.",
      ),
    ).toBeVisible();
  });

  it("says nothing about guardians when both dates are adults'", () => {
    renderPreview(
      preview({
        source: side({ dateOfBirth: "1990-03-01" }),
        survivor: side({ id: "22222222-2222-4222-8222-222222222222", dateOfBirth: "1984-06-12" }),
        conflicts: ["dateOfBirth"],
      }),
    );
    expect(screen.queryByText(/parent or guardian/)).toBeNull();
  });

  it("tells two records under one name apart, in the headers and the swap link", () => {
    renderPreview(
      preview({
        source: side({
          createdAt: new Date("2026-03-03T15:00:00.000Z"),
          counts: { ...zeroCounts, bookings: 4 },
        }),
        survivor: side({
          id: "22222222-2222-4222-8222-222222222222",
          createdAt: new Date("2026-10-07T15:00:00.000Z"),
        }),
        conflicts: [],
      }),
    );
    expect(screen.getByText(/^Added .*Mar.* 4 bookings$/)).toBeVisible();
    expect(screen.getByText(/^Added .*Oct.* 0 bookings$/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: /^Keep Maya Rivera \(Added .*4 bookings\) instead$/ }),
    ).toBeVisible();
  });

  it("keeps a phone number in one piece", () => {
    renderPreview(preview());
    const radio = screen.getByRole("radio", { name: /^Keep \+1\s305\s555\s0142$/ });
    expect(radio.closest("label")?.querySelector(".whitespace-nowrap")).not.toBeNull();
  });

  it("gives a row's label its own line on a phone, so each choice gets half the card", () => {
    renderPreview(preview());
    const label = screen.getByRole("rowheader", { name: "Email" });
    const row = label.closest("tr");
    expect(row).toHaveClass("grid", "grid-cols-2", "sm:table-row");
    expect(label).toHaveClass("col-span-2");
    expect(row?.querySelectorAll("td")).toHaveLength(2);
    const corner = screen.getAllByRole("columnheader")[0];
    expect(corner).toHaveClass("hidden", "sm:table-cell");
  });

  it("refuses with the boat still out", () => {
    renderPreview(preview({ refusal: "departure_underway" }));
    expect(screen.getByText(/Merge after the boat is back\./)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
