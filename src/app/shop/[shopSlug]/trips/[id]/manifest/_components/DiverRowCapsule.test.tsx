// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readinessStatusText } from "@/i18n/readiness-labels";
import type { TripManifest } from "@/lib/manifests";
import { diverCapsule, diverTypeBadge } from "./DiverRowCapsule";
import { boardedAt, diver, renderList, t } from "./diver-roll-call-test-fixtures";
import { diverRowState } from "./diver-row-state";

afterEach(cleanup);

/**
 * **A diver boarding over a physician's earlier "no" says so on the row**
 * (H-98; dive-domain review of #2096). A clean new release clears the diver,
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
    expect(capsuleOf(split.container)).toHaveTextContent("Someone unaccounted for");
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
    expect(container.textContent).toMatch(/did not clear this diver on Aug\s3,\s2026/);
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
    expect(onScreen("Someone unaccounted for").length).toBeGreaterThan(0);
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

describe("diverCapsule, called on its own", () => {
  it("draws the capsule diverRowState chose, and nothing when it chose none", () => {
    const quiet = diver();
    expect(diverCapsule(quiet, diverRowState(quiet, "after_dive_1", false), t)).toBeNull();

    const blocked = diver({
      readiness: { status: "blocked", blockers: [{ code: "certification_missing" }] },
    });
    const { container } = render(
      <span>{diverCapsule(blocked, diverRowState(blocked, "departure", true), t)}</span>,
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
