// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import { rendersFlush } from "@/test/button-flush";
import { ScheduleBuilder, type ScheduleBuilderContext } from "./ScheduleBuilder";
import {
  actions,
  COPY,
  type FixtureDay,
  loadMovePreflight,
  loadOptions,
  MORE,
  PRICE,
  resetScheduleBuilderFixtures,
  weekFrom,
} from "./schedule-builder-test-fixtures";

vi.mock("next/navigation", async () => {
  const navigation = await import("./schedule-builder-test-fixtures");
  return {
    usePathname: navigation.usePathname,
    useRouter: navigation.useRouter,
    useSearchParams: navigation.useSearchParams,
  };
});

afterEach(resetScheduleBuilderFixtures);

describe("ScheduleBuilder add panel: one form, two depths (ADR 20260806-one-trip-create-form)", () => {
  const days: FixtureDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];

  function renderBuilder(overrides: Partial<ScheduleBuilderContext> = {}) {
    return render(
      <ScheduleBuilder
        context={{
          shopSlug: "blue-mantis",
          week: weekFrom(days),
          loadOptions,
          loadMovePreflight,
          price: PRICE,
          actions,
          defaultDateIso: "2026-08-01",
          canConfigure: true,
          locale: "en-US",
          copy: COPY,
          more: MORE,
          initialCourse: null,
          openAdd: "closed",
          ...overrides,
        }}
      />,
    );
  }

  /** What the form would actually post right now. */
  const submittedKeys = (container: HTMLElement) => {
    const form = container.querySelector("form");
    if (!form) throw new Error("the add panel is not open");
    return [...new FormData(form).keys()];
  };

  it("keeps the rare half collapsed, and reveals the whole trip form on request", async () => {
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));

    // Collapsed: the questions the board is for are live, the rest inert.
    // (Inert, not absent — the disclosure hides rather than unmounts. What is
    // *on screen* is a stylesheet's job and the visual specs' to prove; what
    // this asserts is the half that decides the payload.)
    expect(screen.getByLabelText("What is it")).toBeEnabled();
    expect(screen.getByLabelText("Seats")).toBeEnabled();
    expect(screen.getByLabelText("Dives")).toBeEnabled();
    expect(screen.getByLabelText(/^Description/)).toBeDisabled();
    expect(screen.getByLabelText("How many days")).toBeDisabled();
    expect(screen.getByLabelText(/Deposit per diver/)).toBeDisabled();
    expect(screen.getByLabelText("How often")).toBeDisabled();

    const more = screen.getByRole("button", { name: /More options/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);

    // Expanded: everything /trips/new used to ask, on the same form.
    expect(screen.getByLabelText(/^Description/)).toBeEnabled();
    expect(screen.getByLabelText("How many days")).toBeEnabled();
    expect(screen.getByLabelText(/Deposit per diver/)).toBeEnabled();
    expect(screen.getByLabelText(/Free cancellation until/)).toBeEnabled();
    expect(screen.getByLabelText("How often")).toBeEnabled();
    expect(screen.getByLabelText("Number of dives")).toBeEnabled();
    // …and the quick dive box has handed over rather than vanished.
    expect(screen.getByLabelText("Dives")).toBeDisabled();
    // Still one submit — expanding deepens the form, it never forks it.
    expect(screen.getAllByRole("button", { name: "Put it on the board" })).toHaveLength(1);
    expect(submittedKeys(container)).toContain("dayCount");
  });

  /**
   * The disclosure is a line of the form, so its caret starts on the column
   * every label and box above it starts on. Unflushed, the link's `sm`
   * padding set "More options" 12px inside that column at every width
   * (pixel-craft K-223, schedule-builder-add at 1280: 117 against 105).
   */
  it("starts More options and Fewer options on the form's column", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    const more = screen.getByRole("button", { name: /More options/ });
    expect(rendersFlush(more, "link", "sm")).toBe(true);
    await userEvent.click(more);
    expect(rendersFlush(screen.getByRole("button", { name: /Fewer options/ }), "link", "sm")).toBe(
      true,
    );
  });

  /**
   * The private and self-guided boxes are rows of the form, never a label
   * inside a label. Self-guided also takes a caption track only where it has
   * a neighbour to share one with: beside the course select, from `sm`, it
   * spans that field's caption and control rows so its box sits on the
   * select's row. Stacked under the select on a phone, the same empty track
   * and its 4px gutter set it 4px lower than the private row (31px from the
   * select's bottom to its words, against 27; pixel-craft K-330).
   */
  it("draws the private and self-guided boxes as rows, with no empty caption on a phone", async () => {
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));

    for (const name of ["isPrivate", "selfGuided"]) {
      const row = container.querySelector(`input[name="${name}"]`)?.closest("label");
      expect(row, name).not.toBeNull();
      expect(row?.parentElement?.closest("label"), name).toBeNull();
    }

    const wrapper = container
      .querySelector('input[name="selfGuided"]')
      ?.closest("label")?.parentElement;
    const tokens = [...(wrapper?.classList ?? [])];
    expect(tokens).toEqual(expect.arrayContaining(["sm:row-span-2", "sm:grid-rows-subgrid"]));
    expect(tokens).not.toContain("row-span-2");
    expect(tokens).not.toContain("grid-rows-subgrid");
  });

  it("posts only the quick fields while collapsed, though the rest stay mounted", async () => {
    // The disclosure hides rather than unmounts (nothing typed is ever lost),
    // so "not on screen" has to mean "disabled" or a collapsed submission would
    // carry a hidden `dayCount`, deposit, and cadence nobody chose.
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));
    await userEvent.click(screen.getByRole("button", { name: /Fewer options/ }));

    const keys = submittedKeys(container);
    expect(keys).toContain("plannedDives");
    expect(keys).toContain("diveSiteId");
    for (const hidden of [
      "description",
      "dayCount",
      "depositDollars",
      "cancellationWindowHours",
      "repeatIntervalWeeks",
      "dive-1-siteId",
    ]) {
      expect(keys).not.toContain(hidden);
    }
  });

  it("never posts two dive counts: the quick box gives way to the dive plan's own", async () => {
    // `plannedDives` decides how many dive cards render, so two *enabled*
    // controls sharing the name would make the last in the DOM win silently.
    const { container } = renderBuilder();
    const enabled = (name: string) =>
      container.querySelectorAll(`[name="${name}"]:not(:disabled)`).length;

    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    expect(enabled("plannedDives")).toBe(1);
    expect(enabled("diveSiteId")).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: /More options/ }));
    expect(enabled("plannedDives")).toBe(1);
    // One site for the day, or one per dive — never both.
    expect(enabled("diveSiteId")).toBe(0);
    expect(enabled("dive-1-siteId")).toBe(1);
  });

  it("carries the quick dive count and site into the dive plan on first expand", async () => {
    const { container } = renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await screen.findByRole("option", { name: "Molasses Reef" });

    await userEvent.clear(screen.getByLabelText("Dives"));
    await userEvent.type(screen.getByLabelText("Dives"), "3");
    const quickSite = container.querySelector('[name="diveSiteId"]');
    if (!quickSite) throw new Error("the quick dive-site select is missing");
    await userEvent.selectOptions(quickSite, "site-1");

    await userEvent.click(screen.getByRole("button", { name: /More options/ }));

    // Three dives asked for, three dive cards — not the default two.
    expect(screen.getByLabelText("Number of dives")).toHaveValue("3");
    expect(container.querySelectorAll('[name^="dive-"][name$="-siteId"]')).toHaveLength(3);
    // …and the site chosen in the quick row is dive one's, not thrown away.
    expect(container.querySelector('[name="dive-1-siteId"]')).toHaveValue("site-1");
  });

  it("loses nothing across expand → collapse → expand", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await screen.findByRole("option", { name: "Molasses Reef" });
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));

    await userEvent.type(screen.getByLabelText(/^Description/), "Bring a light");
    await userEvent.clear(screen.getByLabelText("How many days"));
    await userEvent.type(screen.getByLabelText("How many days"), "3");
    await userEvent.type(screen.getByLabelText(/Deposit per diver/), "40");
    await userEvent.selectOptions(screen.getByLabelText("How often"), "2");
    await userEvent.type(screen.getAllByLabelText(/^Name/)[0], "Morning reef");

    await userEvent.click(screen.getByRole("button", { name: /Fewer options/ }));
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));

    expect(screen.getByLabelText(/^Description/)).toHaveValue("Bring a light");
    expect(screen.getByLabelText("How many days")).toHaveValue(3);
    expect(screen.getByLabelText(/Deposit per diver/)).toHaveValue(40);
    expect(screen.getByLabelText("How often")).toHaveValue("2");
    expect(screen.getAllByLabelText(/^Name/)[0]).toHaveValue("Morning reef");
  });

  // One frame for the expanded form's three groups, so a sibling cannot drift
  // from the others again: the dive plan had its own corner and phone inset
  // between Pay at booking and Repeat (pixel-craft K-95).
  it("frames the dive plan exactly like Pay at booking and Repeat around it", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));

    const frame = (element: Element | null) => element?.getAttribute("class");
    const pay = screen.getByRole("group", { name: "Pay at booking" });
    const repeat = screen.getByRole("group", { name: "Repeat" });
    const divePlan = screen.getByRole("heading", { name: "The dive plan" }).closest("section");

    expect(frame(pay)).toContain("rounded-lg");
    expect(frame(divePlan)).toBe(frame(pay));
    expect(frame(repeat)).toBe(frame(pay));
  });

  it("mirrors the dive plan's count back to the quick box on the way down", async () => {
    renderBuilder();
    await userEvent.click(screen.getByRole("button", { name: "Add a departure on Sat, Aug 1" }));
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));
    await userEvent.selectOptions(screen.getByLabelText("Number of dives"), "4");
    await userEvent.click(screen.getByRole("button", { name: /Fewer options/ }));

    // Collapsed, the quick box is what submits — it must agree with what the
    // staff member last chose, not with the default it was mounted at.
    expect(screen.getByLabelText("Dives")).toHaveValue(4);
  });

  it("opens already pointed at the course a catalog link named", async () => {
    renderBuilder({
      openAdd: "quick",
      initialCourse: {
        id: "course-1",
        title: "Open Water Diver",
        requirement: "No existing C-card required",
      },
    });

    // No click needed — the link was the click.
    const course = await screen.findByLabelText(/^Course/);
    expect(course).toHaveValue("course-1");
    expect(screen.getByLabelText("What is it")).toHaveAttribute(
      "placeholder",
      "Open Water Diver — Session 1",
    );
    expect(screen.getByText(/No existing C-card required · add an instructor/)).toBeInTheDocument();
  });

  it("opens already pointed at the dive site a library link named", async () => {
    const { container } = renderBuilder({
      openAdd: "quick",
      initialSite: {
        id: "site-1",
        name: "Molasses Reef",
      },
    });

    const site = container.querySelector('select[name="diveSiteId"]');
    expect(site).toHaveValue("site-1");
  });

  it("opens at full depth for a link that meant the whole form", async () => {
    renderBuilder({ openAdd: "expanded" });
    expect(await screen.findByLabelText("How often")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fewer options" })).toBeInTheDocument();
  });

  it("tells a captain whose job scheduling is, rather than showing an empty board", () => {
    renderBuilder({ canConfigure: false });

    expect(screen.queryByRole("button", { name: /Add a departure/ })).toBeNull();
    expect(screen.getByText(/limited to owners, managers, and instructors/)).toBeInTheDocument();
  });
});

/**
 * The request-plan panel is the one place on the board where staff copy is
 * composed on the *client* from a template the server handed over unformatted.
 * That boundary is where issue #606 lived: `boats.requestPlanCrewSuggestion`
 * carried an ICU plural, the page fetched it with `st()` — which formats — and
 * so raised a `FORMATTING_ERROR` on every board render outside production,
 * while production swallowed the error and printed the ICU source to the shop.
 *
 * These tests therefore take their copy from the **real** bundles through a
 * real `staffTranslator`, not from the `COPY` fixture above: a fixture cannot
 * throw the way the page did, and cannot leak a template the fixture doesn't
 * carry. Both locales, and both sides of the plural.
 */
describe("ScheduleBuilder request plan: copy composed on the client", () => {
  const days: FixtureDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];

  /** The half of the copy map `page.tsx` builds for this panel, built the same way. */
  function requestPlanCopy(locale: string) {
    const st = staffTranslator(locale);
    return {
      requestPlanHeading: st("schedule.builder.requestPlanHeading"),
      requestPlanDescription: st("schedule.builder.requestPlanDescription"),
      requestPlanRecommendation: st.raw("schedule.builder.requestPlanRecommendation"),
      requestPlanRecommendationDiversOne: st.raw(
        "schedule.builder.requestPlanRecommendationDiversOne",
      ),
      requestPlanRecommendationDiversOther: st.raw(
        "schedule.builder.requestPlanRecommendationDiversOther",
      ),
      requestPlanRecommendationCapacityOne: st.raw(
        "schedule.builder.requestPlanRecommendationCapacityOne",
      ),
      requestPlanRecommendationCapacityOther: st.raw(
        "schedule.builder.requestPlanRecommendationCapacityOther",
      ),
      requestPlanDiversOne: st.raw("schedule.builder.requestPlanDiversOne"),
      requestPlanDiversOther: st.raw("schedule.builder.requestPlanDiversOther"),
      requestPlanPersonOne: st.raw("schedule.builder.requestPlanPersonOne"),
      requestPlanPersonOther: st.raw("schedule.builder.requestPlanPersonOther"),
      requestPlanBoatRecommendationOne: st.raw("boats.requestPlanBoatRecommendationOne"),
      requestPlanBoatRecommendationOther: st.raw("boats.requestPlanBoatRecommendationOther"),
      requestPlanBoatExceeded: st("boats.requestPlanBoatExceeded"),
      requestPlanCrewSuggestionOne: st.raw("boats.requestPlanCrewSuggestionOne"),
      requestPlanCrewSuggestionOther: st.raw("boats.requestPlanCrewSuggestionOther"),
    };
  }

  function renderPlan(locale: string, divemasters: number, divers: number) {
    return render(
      <ScheduleBuilder
        context={{
          shopSlug: "blue-mantis",
          locale,
          week: weekFrom(days),
          loadOptions,
          loadMovePreflight,
          price: PRICE,
          actions,
          defaultDateIso: "2026-08-01",
          canConfigure: true,
          copy: { ...COPY, ...requestPlanCopy(locale) },
          more: MORE,
          initialCourse: null,
          openAdd: "expanded",
          requestPlan: {
            estimatedDivers: divers,
            suggestedCapacity: 12,
            suggestedDivemasters: divemasters,
            diversPerDivemaster: 4,
            suggestedBoatName: "Reef Runner",
            exceedsKnownBoats: false,
            requests: [{ id: "inq-1", name: "Marisol", subject: "Saturday reef", divers }],
          },
        }}
      />,
    );
  }

  /**
   * The finished sentence, spelled out rather than rebuilt from the bundle —
   * a fixture that composes the expectation the same way the component does
   * agrees with any bug both of them share. `diversPerDivemaster` is 4 in the
   * plan below, so the ratio is fixed too.
   */
  const CASES = [
    {
      locale: "en-US",
      count: 1,
      panel: "Starting from requests",
      crew: "Bring 1 divemaster for your 4:1 target.",
      lead: "Marisol (1 diver)",
    },
    {
      locale: "en-US",
      count: 3,
      panel: "Starting from requests",
      crew: "Bring 3 divemasters for your 4:1 target.",
      lead: "Marisol (3 divers)",
    },
    {
      locale: "es-ES",
      count: 1,
      panel: "Partir de las peticiones",
      crew: "Lleva 1 divemaster para tu objetivo de 4:1.",
      lead: "Marisol (1 buceador)",
    },
    {
      locale: "es-ES",
      count: 3,
      panel: "Partir de las peticiones",
      crew: "Lleva 3 divemasters para tu objetivo de 4:1.",
      lead: "Marisol (3 buceadores)",
    },
  ];

  for (const expected of CASES) {
    it(`says the ${expected.count === 1 ? "singular" : "plural"} in ${expected.locale}`, () => {
      renderPlan(expected.locale, expected.count, expected.count);

      const panel = screen.getByRole("group", { name: expected.panel });
      expect(within(panel).getByText(expected.crew)).toBeInTheDocument();
      expect(within(panel).getByText(expected.lead)).toBeInTheDocument();
      // The failure mode in one line: an unresolved template — an ICU plural
      // `fill()` cannot see, or a `{name}` nobody supplied — reaches the reader
      // as a brace.
      expect(panel.textContent).not.toContain("{");
    });
  }
});
