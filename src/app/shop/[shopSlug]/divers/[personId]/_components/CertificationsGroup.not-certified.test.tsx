// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { DiverStatusRow } from "@/lib/diver-status";
import { CertificationsGroup } from "./CertificationsGroup";
import { DiverStatusLedger } from "./DiverStatusLedger";
import type { DiverProfile, Shop } from "./shared";

// Every control in this group reaches a server action, and with it the whole
// Next server runtime. The suite is about what the group *says*, so they are
// stubbed rather than booted — the same call `WaiverGroup.test.tsx` makes.
vi.mock("../agency-check-actions", () => ({
  addAgencyListedCardsAction: vi.fn(),
  agencyCheckAction: vi.fn(),
}));
vi.mock("../card-actions", () => ({
  addCardAction: vi.fn(),
  clearDrysuitExperienceAction: vi.fn(),
  clearNoCertificationAction: vi.fn(),
  deleteCertificationAction: vi.fn(),
  deleteSpecialtyAction: vi.fn(),
  markCertifiedAction: vi.fn(),
  recordJuniorStatusAction: vi.fn(),
  recordDrysuitExperienceAction: vi.fn(),
  reviewAction: vi.fn(),
  reviewSpecialtyAction: vi.fn(),
}));

afterEach(cleanup);

const t = staffTranslator("en-US");
const SHOP = { timezone: "America/Cancun" } as Shop;

function diver(overrides: Partial<DiverProfile> = {}): DiverProfile {
  return {
    person: {
      id: "person-1",
      fullName: "Priya Sharma",
      noCertificationDeclaredAt: null,
      noCertificationClearedAt: null,
      noCertificationClearedByPersonId: null,
    },
    certifications: [],
    specialtyCertifications: [],
    nitroxCertifications: [],
    noCertificationClearedByName: null,
    ...overrides,
  } as unknown as DiverProfile;
}

function renderGroup(
  profile: DiverProfile,
  gap?: ComponentProps<typeof CertificationsGroup>["gap"],
  shop: Shop = SHOP,
) {
  return render(
    <CertificationsGroup
      diver={profile}
      shop={shop}
      shopSlug="blue-mantis"
      personId="person-1"
      locale="en-US"
      t={t}
      gap={gap}
    />,
  );
}

function door() {
  return screen.getByTestId("diver-file-group-certifications").querySelector("summary");
}

/**
 * **"Not certified for this trip", and the reasons one tap in** (Aaron,
 * 2026-10-23). Three run-on sentences under one row collapse to one fact; the
 * row keeps its danger ink and its departure, so the block is never quieter,
 * and each requirement is one line behind the door. A level the diver is below
 * is said on the status ledger (its fix is another seat), the rest on the
 * certification records row; both say it the same way.
 */
const departure = {
  tripId: "trip-1",
  bookingId: "b1",
  startsAt: new Date("2026-10-09T11:30:00.000Z"),
};

const owCard = {
  id: "c1",
  agency: "padi",
  level: "open_water",
  status: "verified",
  identifier: "1234",
  selfDeclaredAt: null,
};

const ownerExample = {
  kind: "certification" as const,
  tone: "danger" as const,
  sentence: {
    blocker: {
      code: "certification_insufficient" as const,
      params: { requiredLevel: "advanced_open_water" as const, heldLevel: "open_water" as const },
    },
  },
  alsoBlockers: [
    { code: "specialty_missing" as const, params: { specialty: "deep" as const } },
    { code: "nitrox_missing" as const },
  ],
  action: { labelKey: "divers.status.acts.openBooking" as const, target: "open_booking" as const },
  tripContext: departure,
};

describe("a card the diver does not hold", () => {
  it("says only Not certified on the ledger, with every reason folded under it", () => {
    render(
      <DiverStatusLedger
        rows={[ownerExample as unknown as DiverStatusRow]}
        t={t}
        locale="en-US"
        timezone="America/Cancun"
        shopSlug="blue-mantis"
      />,
    );
    const row = screen.getByText("Not certified for this trip.").closest("li");
    expect(row).not.toHaveTextContent("highest certified card");
    const details = screen.getByText("What this trip needs").closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(
      "Advanced Open Water or higher. Their highest verified card is Open Water.",
    );
    expect(details).toHaveTextContent("Deep specialty. None on file.");
    expect(details).toHaveTextContent("Nitrox. None on file.");
  });

  it("says only Not certified on the records row, with the reasons behind the door", () => {
    renderGroup(
      diver({ certifications: [owCard] } as unknown as Partial<DiverProfile>),
      ownerExample as unknown as DiverStatusRow,
    );
    expect(door()).toHaveTextContent(
      "Not certified for this trip. Can’t board Fri, Oct 9 · 6:30 AM.",
    );
    expect(screen.getByTestId("diver-file-group-certifications")).not.toHaveAttribute("open");
    const needs = screen.getByText("What this trip needs").closest("li");
    expect(needs).toHaveTextContent("Deep specialty. None on file.");
    expect(screen.getByText("Nitrox. None on file.")).toHaveClass("text-danger");
  });

  it("names a missing Deep card beside a level card waiting for a look, and keeps the door open", () => {
    renderGroup(
      diver({
        certifications: [{ ...owCard, level: "advanced_open_water", status: "pending" }],
      } as unknown as Partial<DiverProfile>),
      {
        kind: "certification",
        tone: "danger",
        sentence: { blocker: { code: "certification_pending" } },
        alsoBlockers: [{ code: "specialty_missing", params: { specialty: "deep" } }],
        tripContext: departure,
      } as unknown as DiverStatusRow,
    );
    expect(door()).toHaveTextContent("Not certified for this trip.");
    expect(screen.getByTestId("diver-file-group-certifications")).toHaveAttribute("open");
    // The look is a verify task, not a missing card, so it is not in danger ink.
    expect(screen.getByText("Certification is waiting for staff verification.")).not.toHaveClass(
      "text-danger",
    );
    expect(screen.getByText("Deep specialty. None on file.")).toHaveClass("text-danger");
  });

  it("lets an empty file's None on file speak for itself", () => {
    renderGroup(diver(), {
      kind: "certification",
      tone: "danger",
      sentence: { blocker: { code: "certification_missing" } },
      tripContext: departure,
    } as unknown as DiverStatusRow);
    expect(door()).not.toHaveTextContent("Not certified for this trip");
    expect(screen.queryByText("What this trip needs")).not.toBeInTheDocument();
  });

  it("keeps a card waiting for a look off the collapse, with the door open", () => {
    renderGroup(
      diver({
        certifications: [{ ...owCard, level: "advanced_open_water", status: "pending" }],
      } as unknown as Partial<DiverProfile>),
      {
        kind: "certification",
        tone: "danger",
        sentence: { blocker: { code: "specialty_pending", params: { specialty: "deep" } } },
        tripContext: departure,
      } as unknown as DiverStatusRow,
    );
    expect(door()).not.toHaveTextContent("Not certified for this trip");
    expect(screen.getByTestId("diver-file-group-certifications")).toHaveAttribute("open");
  });
});
