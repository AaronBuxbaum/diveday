// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { CertificationsGroup } from "./CertificationsGroup";
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
 * **The door says what this diver is certified to do.** It used to say whether
 * anything was waiting — a queue state the status ledger above already carries
 * with the fix beside it, answered on a row whose whole job is the one fact a
 * staffer opens a record for.
 */
describe("the certification records door", () => {
  it("asks the staffer to sight the junior or full card without a preselected answer", () => {
    renderGroup(
      diver({
        certifications: [
          { id: "c1", agency: "naui", level: "open_water", status: "verified", identifier: "1234" },
        ],
      } as unknown as Partial<DiverProfile>),
    );
    expect(screen.getByText(t("divers.certifications.juniorCardUnknown"))).toBeInTheDocument();
    const select = screen.getByLabelText(t("divers.certifications.juniorCardSelect"));
    expect(select).toHaveValue("");
    expect(select).toBeRequired();
  });
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
          {
            id: "n1",
            agency: "padi",
            status: "verified",
            identifier: "5678",
            selfDeclaredAt: null,
          },
        ],
      } as unknown as Partial<DiverProfile>),
    );

    expect(door()).toHaveTextContent("PADI Open Water · Nitrox");
  });

  it("always offers the add-a-card door, with or without a card on file", () => {
    renderGroup(diver({ certifications: [] } as unknown as Partial<DiverProfile>));

    expect(screen.getByText("Add certification", { exact: true })).toBeInTheDocument();
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
    // Words first, tone second — the treatment `certificationSummaryUnchecked`
    // earns on every other surface that renders somebody's word for it.
    expect(screen.getByText(/SSI Advanced Open Water — unverified/)).toHaveClass(
      "text-warning-strong",
    );
  });

  /**
   * **A claimed certification** (glossary): hand-entered by staff, still
   * `pending`, and never satisfying readiness until somebody looks it up and
   * marks it certified. It read on the closed door as a plain agency and
   * level — the exact scan the self-declared phrase exists to stop, on a card
   * the shop has equally not seen.
   */
  it("marks a hand-entered card nobody has looked up as unverified", () => {
    renderGroup(
      diver({
        certifications: [
          {
            id: "c1",
            agency: "padi",
            level: "rescue",
            status: "pending",
            identifier: "9001",
            selfDeclaredAt: null,
          },
        ],
      } as unknown as Partial<DiverProfile>),
    );

    expect(door()).toHaveTextContent("PADI Rescue Diver — unverified");
    expect(screen.getByText(/PADI Rescue Diver — unverified/)).toHaveClass("text-warning-strong");
  });

  /**
   * An imported specialty card whose gate is still shut (H-20260725-two-findings-dive-domain,
   * `certificationCardRowState` → `imported_unconfirmed`). It stores
   * `verified`, so it read as a plain card the shop holds; the dive it
   * authorizes is waiting on one tap. The phrase is the badge's own words.
   */
  it("marks an imported card still waiting on a confirm", () => {
    renderGroup(
      diver({
        specialtyCertifications: [
          {
            id: "s1",
            agency: "padi",
            specialty: "deep",
            status: "verified",
            identifier: "4321",
            selfDeclaredAt: null,
            importedAt: new Date("2026-08-01T10:00:00.000Z"),
            reviewedAt: null,
          },
        ],
      } as unknown as Partial<DiverProfile>),
    );

    expect(door()).toHaveTextContent("Deep — confirm to clear");
    expect(screen.getByText(/Deep — confirm to clear/)).toHaveClass("text-warning-strong");
  });

  /**
   * **The fact wraps between cards, never inside one** (pixel-craft class 8).
   * On a phone the door's fact takes a line of its own and wraps where the
   * width runs out, so "PADI Advanced Open Water · Deep — confirm to" ended
   * one line and a stray "clear" began the next, reading as the state of the
   * Nitrox card after it. Every space inside a card's phrase, and the one
   * before its separator, is a no-break space: the only place left to break
   * is after a "·".
   */
  it("keeps each card's phrase whole when the fact wraps", () => {
    renderGroup(
      diver({
        certifications: [
          {
            id: "c1",
            agency: "padi",
            level: "advanced_open_water",
            status: "verified",
            identifier: "1234",
            selfDeclaredAt: null,
          },
        ],
        specialtyCertifications: [
          {
            id: "s1",
            agency: "padi",
            specialty: "deep",
            status: "verified",
            identifier: "4321",
            selfDeclaredAt: null,
            importedAt: new Date("2026-08-01T10:00:00.000Z"),
            reviewedAt: null,
          },
        ],
        nitroxCertifications: [
          {
            id: "n1",
            agency: "padi",
            status: "verified",
            identifier: "5678",
            selfDeclaredAt: null,
            importedAt: new Date("2026-08-01T10:00:00.000Z"),
            reviewedAt: null,
          },
        ],
      } as unknown as Partial<DiverProfile>),
    );

    const fact = screen.getByText(/Deep — confirm to clear/);
    const text = fact.textContent ?? "";
    expect(text.replace(/\s+/g, " ")).toBe(
      "PADI Advanced Open Water · Deep — confirm to clear · Nitrox — confirm to clear",
    );
    const breaks = [...text].flatMap((char, index) => (char === " " ? [index] : []));
    expect(breaks).toHaveLength(2);
    for (const index of breaks) expect(text[index - 1], text).toBe("·");
  });

  /**
   * The asymmetry `certificationCardRowState` takes `kind` for: an imported
   * *level* card is genuinely valid on arrival, so its confirm is a nudge and
   * the door must not invent a gate the readiness engine does not enforce.
   */
  it("leaves an imported level card reading as the card the shop holds", () => {
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
            importedAt: new Date("2026-08-01T10:00:00.000Z"),
            reviewedAt: null,
          },
        ],
      } as unknown as Partial<DiverProfile>),
    );

    expect(screen.getByText("PADI Open Water")).toHaveClass("text-muted");
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
    expect(screen.getAllByText("Not certified yet — unverified")[0]).toHaveClass(
      "text-warning-strong",
    );
  });

  it("leaves a door made only of cards the shop holds in quiet ink", () => {
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

    expect(screen.getByText("PADI Open Water")).toHaveClass("text-muted");
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

/**
 * **A card gap is said by this row** (`splitDiverStatus`), with its departure.
 * The status sentence rides along only when the cards cannot say it: a Nitrox
 * card alone is still no level, and "Nitrox" in danger ink would read as a gas
 * problem (dive-domain review, 2026-10-05).
 */
describe("a card gap on the certification records door", () => {
  const missingLevel = {
    kind: "certification" as const,
    tone: "danger" as const,
    sentence: { blocker: { code: "certification_missing" as const } },
    action: { labelKey: "divers.status.acts.addCard" as const, target: "add_card" as const },
    tripContext: {
      tripId: "trip-1",
      bookingId: "b1",
      startsAt: new Date("2026-10-09T11:30:00.000Z"),
    },
  };

  it("lets None on file speak for itself, in danger ink with the departure", () => {
    renderGroup(diver(), missingLevel);
    expect(screen.getByText("None on file")).toHaveClass("text-danger");
    expect(door()).toHaveTextContent("Can’t board Fri, Oct 9 · 6:30 AM.");
    expect(door()).not.toHaveTextContent("No certification is on file for this trip.");
    expect(screen.getByTestId("diver-file-group-certifications")).toHaveAttribute("open");
  });

  it("says why when a Nitrox card is all the diver holds", () => {
    renderGroup(
      diver({
        nitroxCertifications: [
          {
            id: "n1",
            agency: "padi",
            status: "verified",
            identifier: "5678",
            selfDeclaredAt: null,
          },
        ],
      } as unknown as Partial<DiverProfile>),
      missingLevel,
    );
    expect(door()).toHaveTextContent("Not certified for this trip.");
    expect(door()).not.toHaveTextContent("No certification is on file for this trip.");
    expect(screen.getByText("A certification card. None on file.")).toBeInTheDocument();
  });
});

/**
 * **"Check with SSI"** (market audit item 30, inside H-20261007-request-supported-c-card): beside a card that
 * is waiting for somebody, a plain link to the agency's own public lookup, in a
 * new tab. Never on a settled card, and never for an agency that publishes no
 * public lookup (PADI's is member-only).
 */
describe("the agency check link", () => {
  function card(agency: string, status: string) {
    return {
      id: `c-${agency}`,
      agency,
      level: "open_water",
      status,
      identifier: "AB12345",
      selfDeclaredAt: null,
    };
  }

  it("links a pending SSI card to SSI's own diver check in a new tab", () => {
    renderGroup(
      diver({ certifications: [card("ssi", "pending")] } as unknown as Partial<DiverProfile>),
    );
    const link = screen.getByRole("link", { name: "Check with SSI" });
    expect(link).toHaveAttribute("href", "https://my.divessi.com/online_diver_check");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("links a pending specialty card under its own agency", () => {
    renderGroup(
      diver({
        specialtyCertifications: [
          {
            id: "s1",
            agency: "naui",
            specialty: "deep",
            status: "pending",
            identifier: "4321",
            selfDeclaredAt: null,
          },
        ],
      } as unknown as Partial<DiverProfile>),
    );
    expect(screen.getByRole("link", { name: "Check with NAUI" })).toHaveAttribute(
      "href",
      "https://www.naui.org/services/verify-diver-certification/",
    );
  });

  it("draws nothing for a card already certified", () => {
    renderGroup(
      diver({ certifications: [card("ssi", "verified")] } as unknown as Partial<DiverProfile>),
    );
    expect(screen.queryByRole("link", { name: /Check with/ })).toBeNull();
  });

  it("draws nothing for an agency with no lookup", () => {
    renderGroup(
      diver({ certifications: [card("raid", "pending")] } as unknown as Partial<DiverProfile>),
    );
    expect(screen.getByText("AB12345")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Check with|Search the/ })).toBeNull();
  });

  it("names PADI's member sign-in before the staffer meets it", () => {
    renderGroup(
      diver({ certifications: [card("padi", "pending")] } as unknown as Partial<DiverProfile>),
    );
    expect(screen.getByRole("link", { name: "Check with PADI (member sign-in)" })).toHaveAttribute(
      "href",
      "https://pro.padi.com/",
    );
  });

  it("offers the CMAS portal as a search, not a verdict", () => {
    renderGroup(
      diver({ certifications: [card("cmas", "pending")] } as unknown as Partial<DiverProfile>),
    );
    expect(screen.getByRole("link", { name: "Search the CMAS portal" })).toHaveAttribute(
      "href",
      "https://portal.cmas.org/certifications",
    );
    expect(screen.queryByRole("link", { name: /Check with/ })).toBeNull();
  });
});

/**
 * **With the DiveDay extension in this browser** (H-20261008-cert-check-extension), the same words become
 * a button that checks the card on the agency's page. The extension is found by
 * the marker its content script sets; without it, everything above holds.
 */
describe("the agency check, with the extension", () => {
  function pending(agency: string, extra: Record<string, unknown> = {}) {
    return {
      id: `c-${agency}`,
      agency,
      level: "open_water",
      status: "pending",
      identifier: "AB12345",
      selfDeclaredAt: null,
      ...extra,
    };
  }

  function withExtension(run: () => void) {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    try {
      run();
    } finally {
      document.documentElement.removeAttribute("data-diveday-cert-check");
    }
  }

  it("turns the link into a button that checks the card", () => {
    withExtension(() => {
      renderGroup(diver({ certifications: [pending("ssi")] } as unknown as Partial<DiverProfile>));
      expect(screen.getByRole("button", { name: "Check with SSI" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Check with SSI" })).toBeNull();
    });
  });

  it("keeps the link where the record lacks what the agency's form asks for", () => {
    withExtension(() => {
      // NAUI searches by birth date, and this diver has none on file.
      renderGroup(diver({ certifications: [pending("naui")] } as unknown as Partial<DiverProfile>));
      expect(screen.getByRole("link", { name: "Check with NAUI" })).toBeInTheDocument();
    });
  });

  it("keeps the link for a PADI card with no birth date to search DiveChek by, and for a diver's unsighted claim", () => {
    withExtension(() => {
      renderGroup(
        diver({
          certifications: [
            pending("padi"),
            pending("ssi", { selfDeclaredAt: new Date("2026-10-01T00:00:00Z") }),
          ],
        } as unknown as Partial<DiverProfile>),
      );
      expect(screen.queryByRole("button", { name: /Check with/ })).toBeNull();
      expect(
        screen.getByRole("link", { name: "Check with PADI (member sign-in)" }),
      ).toBeInTheDocument();
    });
  });

  it("checks a PADI card with DiveChek when the diver's birth date is on file", () => {
    withExtension(() => {
      const profile = diver({
        certifications: [pending("padi")],
      } as unknown as Partial<DiverProfile>);
      renderGroup(
        {
          ...profile,
          person: { ...profile.person, dateOfBirth: "1990-04-12" },
        } as unknown as DiverProfile,
        undefined,
        { ...SHOP, padiChecksEnabled: true },
      );
      expect(screen.getByRole("button", { name: "Check with PADI" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Check with PADI/ })).toBeNull();
    });
  });

  it("keeps PADI's link, and offers no check, at a shop that has not turned PADI checks on", () => {
    withExtension(() => {
      const profile = diver({
        certifications: [pending("padi"), pending("ssi")],
      } as unknown as Partial<DiverProfile>);
      renderGroup(
        {
          ...profile,
          person: { ...profile.person, dateOfBirth: "1990-04-12" },
        } as unknown as DiverProfile,
        undefined,
        { ...SHOP, padiChecksEnabled: false },
      );
      expect(screen.queryByRole("button", { name: "Check with PADI" })).toBeNull();
      expect(
        screen.getByRole("link", { name: "Check with PADI (member sign-in)" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Check with SSI" })).toBeInTheDocument();
    });
  });

  it("names the agency on a card a check certified", () => {
    renderGroup(
      diver({
        certifications: [
          pending("ssi", {
            status: "verified",
            reviewNote: "Priya Sharma · Open Water Diver",
            reviewedAt: new Date("2026-10-08T15:00:00Z"),
            reviewedByName: "Rae Owner",
            agencyCheckedAt: new Date("2026-10-08T15:00:00Z"),
          }),
        ],
      } as unknown as Partial<DiverProfile>),
    );
    expect(
      screen.getByText(/^Checked with SSI by Rae Owner on Thu,\sOct\s8\.$/),
    ).toBeInTheDocument();
    expect(screen.getByText("Priya Sharma · Open Water Diver")).toBeInTheDocument();
  });
});

/**
 * **A pending nitrox or specialty card gets the check too** (issue #2592), by
 * the same rule the action judges it by: a card with a number of its own, never
 * one a card sighting must confirm. Worded by kind, so a diver's level card and
 * nitrox card at one agency do not wear the same button.
 */
describe("the agency check on a nitrox or specialty card", () => {
  const nitroxCard = (extra: Record<string, unknown> = {}) => ({
    id: "n-1",
    agency: "ssi",
    status: "pending",
    identifier: "AB12345",
    selfDeclaredAt: null,
    issuedByShopAt: null,
    listedFromCertificationId: null,
    importedAt: null,
    reviewedAt: null,
    reviewNote: null,
    ...extra,
  });
  const deepCard = (extra: Record<string, unknown> = {}) => ({
    ...nitroxCard({ id: "s-1", specialty: "deep" }),
    ...extra,
  });

  function withExtension(run: () => void) {
    document.documentElement.setAttribute("data-diveday-cert-check", "1.5.0");
    try {
      run();
    } finally {
      document.documentElement.removeAttribute("data-diveday-cert-check");
    }
  }

  it("turns the agency's link into a button for each kind, worded by the card", () => {
    withExtension(() => {
      renderGroup(
        diver({
          nitroxCertifications: [nitroxCard()],
          specialtyCertifications: [deepCard()],
        } as unknown as Partial<DiverProfile>),
      );
      expect(screen.getByRole("button", { name: "Check Nitrox with SSI" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Check Deep with SSI" })).toBeInTheDocument();
    });
  });

  it("keeps the plain link without the extension", () => {
    renderGroup(
      diver({
        nitroxCertifications: [nitroxCard()],
        specialtyCertifications: [deepCard()],
      } as unknown as Partial<DiverProfile>),
    );
    expect(screen.getAllByRole("link", { name: "Check with SSI" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Check .* with SSI/ })).toBeNull();
  });

  it("states an unsighted nitrox declaration once and retains its sighting action", () => {
    renderGroup(
      diver({
        nitroxCertifications: [nitroxCard({ selfDeclaredAt: new Date("2026-10-01T00:00:00Z") })],
      } as unknown as Partial<DiverProfile>),
    );
    expect(
      screen.getAllByText(t("divers.certifications.selfDeclaredLabel"), { exact: true }),
    ).toHaveLength(1);
    expect(screen.getByText(t("divers.certifications.sightCard"))).toBeInTheDocument();
  });

  it("offers no button on a card a sighting must confirm, or on a settled one", () => {
    withExtension(() => {
      renderGroup(
        diver({
          nitroxCertifications: [
            // The diver's own tick, a card this shop issued, a listed card with no number, a settled one.
            nitroxCard({ id: "n-claim", selfDeclaredAt: new Date("2026-10-01T00:00:00Z") }),
            nitroxCard({ id: "n-settled", status: "verified", reviewedAt: new Date() }),
          ],
          specialtyCertifications: [
            deepCard({ id: "s-issued", issuedByShopAt: new Date("2026-10-01T00:00:00Z") }),
            deepCard({ id: "s-nonumber", identifier: null, listedFromCertificationId: "c-1" }),
          ],
        } as unknown as Partial<DiverProfile>),
      );
      expect(screen.queryByRole("button", { name: /Check .* with SSI/ })).toBeNull();
    });
  });
});

/**
 * **A card an agency check listed** (layer 3): its stamp says the note is the
 * agency's words, before and after Mark certified, and a card filed with no
 * number of its own is confirmed through the sighting.
 */
describe("a card an agency check listed", () => {
  function listed(extra: Record<string, unknown> = {}) {
    return {
      id: "n-listed",
      agency: "sdi",
      status: "pending",
      identifier: "SDI-2002",
      selfDeclaredAt: null,
      reviewNote: "Lena Ortiz · Computer Nitrox Diver",
      listedFromCertificationId: "c-1",
      ...extra,
    };
  }

  it("says the words are the agency's page, whatever the card's state", () => {
    for (const status of ["pending", "verified"]) {
      renderGroup(
        diver({ nitroxCertifications: [listed({ status })] } as unknown as Partial<DiverProfile>),
      );
      expect(screen.getByText("Listed on SDI’s page.")).toBeInTheDocument();
      expect(screen.getByText("Lena Ortiz · Computer Nitrox Diver")).toBeInTheDocument();
      cleanup();
    }
    // A staffer's own note on a card no check listed claims no page.
    renderGroup(
      diver({
        nitroxCertifications: [listed({ listedFromCertificationId: null })],
      } as unknown as Partial<DiverProfile>),
    );
    expect(screen.queryByText("Listed on SDI’s page.")).toBeNull();
  });

  it("asks for the card when the page showed no number for it", () => {
    renderGroup(
      diver({
        nitroxCertifications: [listed({ identifier: null })],
      } as unknown as Partial<DiverProfile>),
    );
    expect(screen.getByText("Verify certification record")).toBeInTheDocument();
    cleanup();
    // With the number its own line showed, the ordinary one tap.
    renderGroup(diver({ nitroxCertifications: [listed()] } as unknown as Partial<DiverProfile>));
    expect(screen.queryByText("Verify certification record")).toBeNull();
  });
});

/**
 * **Seen diving dry is staff-observed, never a card** (issue #2136). It sits
 * in this group beside the cards, says who recorded it, and leaves everything
 * the cards say untouched.
 */
describe("drysuit experience seen", () => {
  const seen = (overrides: Record<string, unknown> = {}) =>
    diver({
      person: {
        id: "person-1",
        fullName: "Priya Sharma",
        noCertificationDeclaredAt: null,
        noCertificationClearedAt: null,
        noCertificationClearedByPersonId: null,
        drysuitExperienceSeenAt: new Date("2026-10-01T15:00:00Z"),
        drysuitExperienceSeenByPersonId: "staff-1",
        drysuitExperienceSeenNote: "Own DUI shell, three shore dives",
      },
      drysuitExperienceSeenByName: "Dana Reyes",
      rentalFit: { divesDry: true },
      ...overrides,
    } as unknown as Partial<DiverProfile>);

  it("names who recorded it and labels it staff-observed, not a card", () => {
    renderGroup(seen());
    expect(screen.getByText("Seen diving dry")).toBeInTheDocument();
    expect(
      screen.getByText(/Recorded by Dana Reyes on .*Staff-observed, not a drysuit card/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    // Domain review A5: what they saw travels with who saw it.
    expect(screen.getByText(/Own DUI shell, three shore dives/)).toBeInTheDocument();
  });

  it("asks what was seen before recording it", () => {
    renderGroup(diver({ rentalFit: { divesDry: true } } as unknown as Partial<DiverProfile>));
    const note = screen.getByRole("textbox", { name: "What you saw" });
    expect(note).toBeRequired();
    expect(note).toHaveAttribute("maxLength", "200");
  });

  it("never reads as a card: the door and the empty state are unchanged", () => {
    renderGroup(seen());
    expect(screen.getByText("No certification records yet")).toBeInTheDocument();
    expect(door()).not.toHaveTextContent(/drysuit/i);
  });

  it("offers the control only where the roster advisory would fire", () => {
    const unrecorded = (fit: unknown, specialtyCertifications: unknown[] = []) =>
      diver({ rentalFit: fit, specialtyCertifications } as unknown as Partial<DiverProfile>);

    renderGroup(unrecorded({ divesDry: true }));
    expect(screen.getByRole("button", { name: "I’ve seen them dive dry" })).toBeInTheDocument();
    cleanup();

    renderGroup(unrecorded({ divesDry: false }));
    expect(screen.queryByRole("button", { name: "I’ve seen them dive dry" })).toBeNull();
    cleanup();

    renderGroup(unrecorded(null));
    expect(screen.queryByRole("button", { name: "I’ve seen them dive dry" })).toBeNull();
    cleanup();

    renderGroup(
      unrecorded({ divesDry: true }, [
        {
          id: "s1",
          specialty: "drysuit",
          agency: "padi",
          status: "verified",
          importedAt: null,
          reviewedAt: null,
          selfDeclaredAt: null,
          identifier: "D1",
        },
      ]),
    );
    expect(screen.queryByRole("button", { name: "I’ve seen them dive dry" })).toBeNull();
    cleanup();

    // A drysuit card awaiting review: confirming it is the fix (domain review F4).
    renderGroup(
      unrecorded({ divesDry: true }, [
        {
          id: "s2",
          specialty: "drysuit",
          agency: "padi",
          status: "pending",
          importedAt: null,
          reviewedAt: null,
          selfDeclaredAt: null,
          identifier: "D2",
        },
      ]),
    );
    expect(screen.queryByRole("button", { name: "I’ve seen them dive dry" })).toBeNull();
  });
});
