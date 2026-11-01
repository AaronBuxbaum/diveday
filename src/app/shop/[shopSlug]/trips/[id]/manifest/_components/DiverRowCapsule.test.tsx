// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readinessStatusText } from "@/i18n/readiness-labels";
import { buddyAlertFor, type TripManifest } from "@/lib/manifests";
import { diverCapsule, diverTypeBadge } from "./DiverRowCapsule";
import {
  boardedAt,
  dangerToned,
  diver,
  notBackAt,
  renderList,
  t,
} from "./diver-roll-call-test-fixtures";
import { diverRowState } from "./diver-row-state";

afterEach(cleanup);

/**
 * **A diver boarding over a physician's earlier "no" says so on the row**
 * (H-20261007-after-physician-says-no; dive-domain review of #2096). A clean new release clears the diver,
 * and the warning used to live only in the person sheet, one tap away from
 * the rail where the crew decides. It takes the row's one capsule below a
 * split buddy team and a desk blocker, and above the minor, depth and
 * birthday capsules; the minor flag it displaces still reaches the panel and
 * the paper.
 */
describe("the earlier-refusal capsule", () => {
  const refusedBefore = {
    at: new Date("2026-09-01T12:00:00.000Z"),
    source: "digital",
    overriddenReferralAt: null,
    overriddenRefusal: { recordId: "w-refused", at: new Date("2026-08-20T12:00:00.000Z") },
    clearance: null,
    guardian: null,
  } as unknown as TripManifest["divers"][number]["medicalWaiver"];
  const CAPSULE = "Physician said no before";

  function capsuleOf(container: HTMLElement) {
    return container.querySelector(".basis-full");
  }

  it("puts a warning capsule on the row", () => {
    const { container } = renderList({ divers: [diver({ medicalWaiver: refusedBefore })] });
    const capsule = capsuleOf(container);
    expect(capsule).toHaveTextContent(CAPSULE);
    expect(within(capsule as HTMLElement).getByText(CAPSULE).className).toContain(
      "text-warning-strong",
    );
  });

  it("gives way to a rider's riding-only warning, which the row and its details both say (H-20261009-rider-snorkeler-medical)", () => {
    // A clean release over an older "no", and a later "no" the rider boards
    // under: both warnings stand, and the riding-only one takes the row.
    const { container } = renderList({
      divers: [
        diver({
          participantType: "rider",
          medicalWaiver: refusedBefore,
          riderMedicalHold: {
            kind: "not_cleared",
            at: new Date("2026-09-05T12:00:00.000Z"),
            evaluatedOn: "2026-09-04",
          },
        }),
      ],
    });
    expect(capsuleOf(container)).toHaveTextContent("Riding only: MD said no");
    expect(capsuleOf(container)).not.toHaveTextContent(CAPSULE);
    expect(container.textContent).toMatch(
      /A physician did not clear this person on Sep\s4,\s2026: riding only, not in the water/,
    );
    const printed = container.querySelector<HTMLElement>(".hidden.print\\:block");
    expect(within(printed as HTMLElement).getByText(CAPSULE)).toBeDefined();
  });

  it("is short in Spanish too", () => {
    const { container } = renderList({
      divers: [diver({ medicalWaiver: refusedBefore })],
      locale: "es-ES",
    });
    const text = capsuleOf(container)?.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(24);
  });

  it("yields to a split buddy team and to a desk blocker", () => {
    const split = renderList({
      divers: [
        diver({
          medicalWaiver: refusedBefore,
          buddyAlert: "separated_after_dive",
          buddyTeam: { teamId: "t-1", others: [] },
        }),
      ],
    });
    expect(capsuleOf(split.container)).toHaveTextContent("Buddy not back aboard");
    expect(capsuleOf(split.container)).not.toHaveTextContent(CAPSULE);
    split.unmount();

    const blocked = renderList({
      checkpoint: "departure",
      divers: [
        diver({
          medicalWaiver: refusedBefore,
          readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
        }),
      ],
    });
    expect(capsuleOf(blocked.container)).not.toHaveTextContent(CAPSULE);
  });

  it("outranks the minor, depth and birthday capsules, and the minor flag still shows", () => {
    renderList({
      divers: [
        diver({
          medicalWaiver: refusedBefore,
          age: 13,
          minor: true,
          birthday: { status: "today" },
        }),
      ],
    });
    const row = screen.getByRole("listitem");
    expect(row.querySelector(".basis-full")).toHaveTextContent(CAPSULE);
    expect(row.querySelector(".basis-full")).not.toHaveTextContent("Minor");
    expect(screen.getAllByText("Minor · age 13").length).toBeGreaterThan(0);
  });

  /**
   * **A minor with a physician's earlier "no", recorded not back aboard**
   * (issue #2307). The alarm takes the row on screen and nothing sits beside
   * it: no refusal capsule and no minor capsule. The facts still reach the
   * reader: the age in the person's own panel, and on paper the refusal
   * sentence with the minor flag beside it.
   */
  it("gives a not-back minor's refusal no capsule on screen, the age in the panel, and the sentence on paper", () => {
    const { container } = renderList({
      divers: [
        diver({
          medicalWaiver: refusedBefore,
          age: 13,
          minor: true,
          boardedEarlier: true,
          rollCall: notBackAt(),
        }),
      ],
    });
    const printed = container.querySelector<HTMLElement>(".hidden.print\\:block");
    if (!printed) throw new Error("no printed block");
    const onScreen = (text: string | RegExp) =>
      screen.queryAllByText(text).filter((element) => !printed.contains(element));
    expect(capsuleOf(container)).toBeNull();
    expect(onScreen(CAPSULE)).toHaveLength(0);
    expect(onScreen(/Minor/)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Open details for Meera Iyer" }));
    expect(within(screen.getByRole("dialog")).getByText("Minor · age 13")).toBeDefined();

    expect(printed).toHaveTextContent(
      /A physician did not clear this person on .* \(earlier waiver\)/,
    );
    expect(printed).toHaveTextContent(CAPSULE);
    expect(printed).toHaveTextContent("Minor · age 13");
  });

  /**
   * **What paper restates is decided by the capsule the row actually drew**
   * (issue #2307). A buddy alert with no team to name draws no buddy capsule,
   * so the refusal takes the row; paper must not then print the refusal a
   * second time beside the one already on the summary line.
   */
  it("prints the refusal once when a teamless buddy alert gives it the row", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [
        diver({
          medicalWaiver: refusedBefore,
          buddyAlert: "separated_dock",
          buddyTeam: null,
          rollCall: boardedAt(),
        }),
      ],
    });
    expect(capsuleOf(container)).toHaveTextContent(CAPSULE);
    const printed = container.querySelector<HTMLElement>(".hidden.print\\:block");
    expect(within(printed as HTMLElement).queryAllByText(CAPSULE)).toHaveLength(0);
  });

  it("dates the refusal by the physician's evaluation, with the year", () => {
    const evaluated = {
      ...refusedBefore,
      overriddenRefusal: {
        recordId: "w-refused",
        at: new Date("2026-08-20T12:00:00.000Z"),
        evaluatedOn: "2026-08-03",
      },
    } as TripManifest["divers"][number]["medicalWaiver"];
    const { container } = renderList({ divers: [diver({ medicalWaiver: evaluated })] });
    expect(container.textContent).toMatch(/did not clear this person on Aug\s3,\s2026/);
  });
});

/**
 * **A diver aboard while blocked reads "Blocked", not their buddy's absence**
 * (dive-domain review of the manifest-blocked-aboard capture). At the dock,
 * `separated_dock` is a heads-up about a teammate still to gather; the
 * readiness blocker is about *this* body, aboard a boat it is not cleared
 * for, and the head count above already says so. Only a split team after a
 * dive outranks the blocker.
 */
/**
 * **The split-team chip names the buddy, on the row of the one aboard** (UX
 * review 2026-10-10, item 23). It read "Someone not aboard" on the diver who
 * *was* aboard, which a crew read as that diver missing. The alert belongs on
 * the boarded diver's row (`buddyAlertFor`), so the words have to say whose
 * absence it is; the teammate still ashore wears no chip, because their own
 * row already says they are not aboard.
 */
describe("a buddy team split at the dock", () => {
  it("says the buddy is not aboard yet on the boarded row, and nothing on the ashore one", () => {
    const team = { teamId: "t-1", others: [] };
    const aboard = boardedAt();
    const ashore = undefined;
    renderList({
      checkpoint: "departure",
      divers: [
        diver({
          fullName: "Meera Iyer",
          rollCall: aboard,
          buddyAlert: buddyAlertFor("departure", aboard, [ashore]),
          buddyTeam: team,
        }),
        diver({
          bookingId: "00000000-0000-4000-8000-000000000002",
          fullName: "Ravi Iyer",
          rollCall: ashore,
          buddyAlert: buddyAlertFor("departure", ashore, [aboard]),
          buddyTeam: team,
        }),
      ],
    });
    const rows = screen.getAllByRole("listitem");
    const rowOf = (name: string) => {
      const row = rows.find((item) => within(item).queryByText(name));
      if (!row) throw new Error(`no row for ${name}`);
      return row;
    };
    expect(within(rowOf("Meera Iyer")).getAllByText("Buddy not aboard yet").length).toBeGreaterThan(
      0,
    );
    expect(within(rowOf("Ravi Iyer")).queryByText(/not aboard yet|Someone/)).toBeNull();
  });
});

describe("a blocked diver marked aboard at the dock", () => {
  const blocked: TripManifest["divers"][number]["readiness"] = {
    status: "blocked",
    blockers: [{ code: "certification_missing" }],
  };
  const SEPARATED_AT_DOCK = t("shared.buddyTeam.separatedDock");

  function onScreen(text: string) {
    return screen
      .queryAllByText(text)
      .filter((element) => !element.closest(".hidden.print\\:block"));
  }

  it("says Blocked over a teammate still ashore", () => {
    renderList({
      checkpoint: "departure",
      divers: [
        diver({
          readiness: blocked,
          rollCall: boardedAt(),
          buddyAlert: "separated_dock",
          buddyTeam: { teamId: "t-1", others: [] },
        }),
      ],
    });
    expect(onScreen("Blocked").length).toBeGreaterThan(0);
    expect(onScreen(SEPARATED_AT_DOCK)).toHaveLength(0);
  });

  it("keeps the buddy heads-up for a cleared diver", () => {
    renderList({
      checkpoint: "departure",
      divers: [
        diver({
          rollCall: boardedAt(),
          buddyAlert: "separated_dock",
          buddyTeam: { teamId: "t-1", others: [] },
        }),
      ],
    });
    expect(onScreen(SEPARATED_AT_DOCK).length).toBeGreaterThan(0);
  });

  it("still yields to a team that did not come back after a dive", () => {
    renderList({
      divers: [
        diver({
          readiness: blocked,
          boardedEarlier: false,
          rollCall: boardedAt(),
          buddyAlert: "separated_after_dive",
          buddyTeam: { teamId: "t-1", others: [] },
        }),
      ],
    });
    expect(onScreen("Buddy not back aboard").length).toBeGreaterThan(0);
    expect(onScreen("Blocked")).toHaveLength(0);
  });
});

describe("the unresolved-referral capsule", () => {
  const referred = {
    at: new Date("2026-09-01T12:00:00.000Z"),
    source: "digital",
    overriddenReferralAt: new Date("2026-06-11T02:00:00.000Z"),
    overriddenRefusal: null,
    clearance: null,
    guardian: null,
  } as unknown as TripManifest["divers"][number]["medicalWaiver"];

  it("puts a warning capsule on the row, and dates the referral with its year", () => {
    const { container } = renderList({ divers: [diver({ medicalWaiver: referred })] });
    expect(container.querySelector(".basis-full")).toHaveTextContent("Referral still open");
    expect(container.textContent).toMatch(
      /Referred to a physician on Jun\s10,\s2026; re-signed with no physician clearance on file/,
    );
  });

  it("yields to an earlier refusal, which keeps the capsule", () => {
    const both = {
      ...referred,
      overriddenRefusal: { recordId: "w", at: new Date("2026-05-02T16:00:00.000Z") },
    } as TripManifest["divers"][number]["medicalWaiver"];
    const { container } = renderList({ divers: [diver({ medicalWaiver: both })] });
    expect(container.querySelector(".basis-full")).toHaveTextContent("Physician said no before");
    expect(container.querySelector(".basis-full")).not.toHaveTextContent("Referral still open");
  });

  it("is short in Spanish too", () => {
    const { container } = renderList({
      divers: [diver({ medicalWaiver: referred })],
      locale: "es-ES",
    });
    const text = container.querySelector(".basis-full")?.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(24);
  });
});

/**
 * **The riding-only capsules fit beside a name on a phone** (#2386): held to
 * the same 24 characters as every other capsule, in both locales, and still
 * saying both that the rider stays aboard and why.
 */
describe("the riding-only capsules", () => {
  const holds = [
    { kind: "not_cleared", en: "Riding only: MD said no", es: "Solo a bordo: no apto" },
    { kind: "referral", en: "Riding only: referred", es: "Solo a bordo: derivado" },
  ] as const;

  for (const hold of holds) {
    for (const locale of ["en-US", "es-ES"] as const) {
      it(`says ${hold.kind} in 24 characters or fewer (${locale})`, () => {
        const { container } = renderList({
          divers: [
            diver({
              participantType: "rider",
              riderMedicalHold: {
                kind: hold.kind,
                at: new Date("2026-09-05T12:00:00.000Z"),
                evaluatedOn: "2026-09-04",
              },
            }),
          ],
          locale,
        });
        const capsule = container.querySelector<HTMLElement>(".basis-full");
        const words = locale === "en-US" ? hold.en : hold.es;
        // The capsule line also carries the rider's type badge; the cap is the chip's.
        const chip = within(capsule as HTMLElement).getByText(words);
        expect(chip.textContent?.length).toBeLessThanOrEqual(24);
      });
    }
  }
});

describe("diverCapsule, called on its own", () => {
  it("draws the capsule diverRowState chose, and nothing when it chose none", () => {
    const quiet = diver();
    expect(
      diverCapsule(quiet, diverRowState(quiet, "after_dive_1", false, "America/New_York"), t),
    ).toBeNull();

    const blocked = diver({
      readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
    });
    const { container } = render(
      <span>
        {diverCapsule(blocked, diverRowState(blocked, "departure", true, "America/New_York"), t)}
      </span>,
    );
    expect(container).toHaveTextContent(readinessStatusText(t, "blocked"));
  });

  it("names a snorkeler's seat beside the capsule, and says nothing for a diver", () => {
    expect(diverTypeBadge(diver(), t)).toBeNull();
    const { container } = render(
      <span>{diverTypeBadge(diver({ participantType: "snorkeler" }), t)}</span>,
    );
    expect(container.textContent?.length).toBeGreaterThan(0);
  });
});

/**
 * **A diver boarded over a medical blocker keeps a medical capsule after a
 * dive** (issue #2380, Aaron's decision (b)): warning-toned, never the danger
 * "Blocked", placed where the rider's riding-only chip sits.
 */
describe("the medical-hold capsule after a dive", () => {
  const notCleared: TripManifest["divers"][number]["readiness"] = {
    status: "blocked",
    blockers: [{ code: "medical_not_cleared" }],
  };
  const inReview: TripManifest["divers"][number]["readiness"] = {
    status: "blocked",
    blockers: [{ code: "medical_review" }],
  };
  const NOT_CLEARED = "Not medically cleared";
  const IN_REVIEW = "Medical review open";

  function capsuleOf(container: HTMLElement) {
    return container.querySelector<HTMLElement>(".basis-full");
  }

  for (const checkpoint of ["after_dive_1", "after_dive_2", "after_dive_3"] as const) {
    it(`stays on the row of a diver boarded over a physician's no at ${checkpoint}`, () => {
      const { container } = renderList({
        checkpoint,
        divers: [diver({ readiness: notCleared, boardedEarlier: true, rollCall: boardedAt() })],
      });
      const capsule = capsuleOf(container);
      expect(capsule).toHaveTextContent(NOT_CLEARED);
      expect(within(capsule as HTMLElement).getByText(NOT_CLEARED).className).toContain(
        "text-warning-strong",
      );
      // Not the danger "Blocked": decision 4 keeps the red for the alarm.
      expect(capsule).not.toHaveTextContent(readinessStatusText(t, "blocked"));
      expect(dangerToned(capsule as HTMLElement)).toHaveLength(0);
    });
  }

  it("names an open medical review, before anyone has been called at this checkpoint", () => {
    const { container } = renderList({
      divers: [diver({ readiness: inReview, boardedEarlier: true })],
    });
    expect(capsuleOf(container)).toHaveTextContent(IN_REVIEW);
  });

  it("says nothing at the dock, where the row says Blocked", () => {
    const { container } = renderList({
      checkpoint: "departure",
      divers: [diver({ readiness: notCleared, rollCall: boardedAt() })],
    });
    expect(capsuleOf(container)).toHaveTextContent(readinessStatusText(t, "blocked"));
    expect(container.querySelector(".basis-full")).not.toHaveTextContent(NOT_CLEARED);
  });

  it("gives way to the not-back alarm: nothing beside somebody in the water", () => {
    const { container } = renderList({
      divers: [diver({ readiness: notCleared, boardedEarlier: true, rollCall: notBackAt() })],
    });
    expect(capsuleOf(container)).toBeNull();
  });

  it("gives way to a team that did not come back after a dive", () => {
    const { container } = renderList({
      divers: [
        diver({
          readiness: notCleared,
          boardedEarlier: true,
          rollCall: boardedAt(),
          buddyAlert: "separated_after_dive",
          buddyTeam: { teamId: "t-1", others: [] },
        }),
      ],
    });
    expect(capsuleOf(container)).toHaveTextContent("Buddy not back aboard");
    expect(capsuleOf(container)).not.toHaveTextContent(NOT_CLEARED);
  });

  it("outranks the minor, depth and birthday capsules", () => {
    const state = diverRowState(
      diver({
        readiness: notCleared,
        boardedEarlier: true,
        age: 13,
        minor: true,
        birthday: { status: "today" },
      }),
      "after_dive_1",
      false,
      "America/New_York",
    );
    expect(state.capsuleKind).toBe("medicalHold");
  });

  it("stays off a paperwork blocker, which decision 4 keeps quiet after a dive", () => {
    const { container } = renderList({
      divers: [
        diver({
          readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
          boardedEarlier: true,
          rollCall: boardedAt(),
        }),
      ],
    });
    expect(capsuleOf(container)).toBeNull();
  });

  for (const locale of ["en-US", "es-ES"] as const) {
    it(`fits the 24-character capsule in ${locale}`, () => {
      for (const readiness of [notCleared, inReview]) {
        cleanup();
        const { container } = renderList({
          locale,
          divers: [diver({ readiness, boardedEarlier: true })],
        });
        expect(capsuleOf(container)?.textContent?.length ?? 0).toBeGreaterThan(0);
        expect(capsuleOf(container)?.textContent?.length).toBeLessThanOrEqual(24);
      }
    });
  }
});
