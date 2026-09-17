// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { CertificationsGroup } from "./CertificationsGroup";
import type { DiverProfile, Shop } from "./shared";

// Every control in this group reaches a server action, and with it the whole
// Next server runtime. The suite is about what the group *says*, so they are
// stubbed rather than booted — the same call `WaiverGroup.test.tsx` makes.
vi.mock("../actions", () => ({
  addCardAction: vi.fn(),
  clearNoCertificationAction: vi.fn(),
  deleteCertificationAction: vi.fn(),
  deleteSpecialtyAction: vi.fn(),
  markCertifiedAction: vi.fn(),
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

function renderGroup(profile: DiverProfile) {
  return render(
    <CertificationsGroup
      diver={profile}
      shop={SHOP}
      shopSlug="blue-mantis"
      personId="person-1"
      locale="en-US"
      t={t}
    />,
  );
}

function door() {
  return screen.getByTestId("diver-file-group-certifications").querySelector("summary");
}

/**
 * **The door says what this diver is certified to do.** It used to say whether
 * anything was waiting — a queue state the status ledger above already carries
 * with the fix beside it, answered on a row whose whole job is the one fact a
 * staffer opens a record for.
 */
describe("the certification records door", () => {
  it("names the agency and the level of every card on file", () => {
    renderGroup(
      diver({
        certifications: [
          {
            id: "c1",
            agency: "padi",
            level: "open_water",
            status: "verified",
            identifier: "1234",
            selfDeclaredAt: null,
          },
        ],
        nitroxCertifications: [
          { id: "n1", agency: "padi", status: "verified", identifier: "5678", selfDeclaredAt: null },
        ],
      } as unknown as Partial<DiverProfile>),
    );

    expect(door()).toHaveTextContent("PADI Open Water · Nitrox");
  });

  /**
   * A claim the shop has never seen may not read on a closed door as though it
   * had. The phrase is the shared one (`shared.certificationSummary.selfDeclared`),
   * never a second spelling local to this group.
   */
  it("marks an unsighted self-declaration as unverified", () => {
    renderGroup(
      diver({
        certifications: [
          {
            id: "c1",
            agency: "ssi",
            level: "advanced_open_water",
            status: "pending",
            identifier: null,
            declaredIdentifier: null,
            selfDeclaredAt: new Date("2026-08-01T10:00:00.000Z"),
          },
        ],
      } as unknown as Partial<DiverProfile>),
    );

    expect(door()).toHaveTextContent("SSI Advanced Open Water — unverified");
  });

  it("says None on file when the record holds nothing", () => {
    renderGroup(diver());
    expect(door()).toHaveTextContent(/Certification records\s*None on file/);
  });

  /**
   * A diver who has told the shop they hold no card said something; silence did
   * not. The two must not read alike on the door.
   */
  it("carries the diver’s own “not certified” statement instead", () => {
    renderGroup(
      diver({
        person: {
          id: "person-1",
          fullName: "Priya Sharma",
          noCertificationDeclaredAt: new Date("2026-08-01T10:00:00.000Z"),
          noCertificationClearedAt: null,
          noCertificationClearedByPersonId: null,
        },
      } as unknown as Partial<DiverProfile>),
    );

    expect(door()).toHaveTextContent("Not certified yet — unverified");
  });

  /**
   * A bordered `danger` button stood on every row at rest, in the group a
   * staffer reads to decide whether somebody dives. Quiet ink, same act, same
   * undo.
   */
  it("keeps the row’s delete at ghost weight", () => {
    renderGroup(
      diver({
        certifications: [
          {
            id: "c1",
            agency: "padi",
            level: "open_water",
            status: "verified",
            identifier: "1234",
            selfDeclaredAt: null,
          },
        ],
      } as unknown as Partial<DiverProfile>),
    );

    const remove = screen.getByRole("button", { name: "Delete" });
    expect(remove).toHaveClass("text-danger");
    // The bordered `danger` variant's own marker, and the thing that made it
    // the loudest control in the group.
    expect(remove.className).not.toMatch(/border-danger/);
  });
});
