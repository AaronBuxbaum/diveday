// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rendersFlush } from "@/test/button-flush";
import { ScheduleBuilder, type ScheduleBuilderContext } from "./ScheduleBuilder";
import {
  actions,
  baseTrip,
  COPY,
  type FixtureDay,
  loadMovePreflight,
  loadOptions,
  MORE,
  PRICE,
  resetScheduleBuilderFixtures,
  routerPush,
  routerReplace,
  useSearchParams,
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

describe("ScheduleBuilder add panel: price, and options fetched on open", () => {
  const days: FixtureDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];

  function renderBuilder() {
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
          openAdd: "quick",
        }}
      />,
    );
  }

  it("offers an optional price box, currency-shaped by the server", async () => {
    renderBuilder();

    const price = screen.getByLabelText(/Price per diver/);
    expect(price).toHaveAttribute("name", "priceDollars");
    // Optional in the honest sense: empty is a valid submission, and the row
    // then wears the "No price set" badge until somebody prices it.
    expect(price).not.toBeRequired();
    expect(price).toHaveValue(null);
    expect(price).toHaveAttribute("step", "0.01");
    expect(price).toHaveAttribute("placeholder", "$0.00");
  });

  it("loads course and site choices for the creation page", async () => {
    renderBuilder();
    expect(await screen.findByRole("option", { name: "Open Water Diver" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Molasses Reef" })).toBeInTheDocument();
    expect(loadOptions).toHaveBeenCalledTimes(1);
  });

  it("groups course choices by agency while keeping each agency's order", async () => {
    loadOptions.mockResolvedValueOnce({
      courses: [
        { id: "padi-ow", title: "Open Water Diver", agency: "padi", priceLabel: null },
        { id: "ssi-ow", title: "SSI Open Water Diver", agency: "ssi", priceLabel: null },
        { id: "other", title: "Custom Course", agency: "naui", priceLabel: null },
      ],
      diveSites: [],
    });
    const { container } = renderBuilder();

    const courseSelect = await vi.waitFor(() => {
      const select = container.querySelector('select[name="courseId"]');
      if (!select) throw new Error("course selector is not mounted yet");
      return select;
    });
    await waitFor(() => expect(courseSelect.querySelectorAll("optgroup")).toHaveLength(3));
    expect(courseSelect.querySelector('optgroup[label="PADI"]')).toHaveTextContent(
      "Open Water Diver",
    );
    expect(courseSelect.querySelector('optgroup[label="SSI"]')).toHaveTextContent(
      "SSI Open Water Diver",
    );
    expect(courseSelect.querySelector('optgroup[label="NAUI"]')).toHaveTextContent("Custom Course");
  });

  /**
   * **The self-guided box goes away once a course is picked** (issue #1342).
   *
   * Self-guided means the divers go in unguided in buddy pairs; a certification
   * dive requires the instructor supervising. `insertTripInstance` refuses the
   * combination whatever this form posts, so the box would be *ignored* rather
   * than obeyed — and a control that has no effect is worse than one that is
   * absent, because a staffer who ticks it believes something about the day
   * that is not true.
   *
   * Asserted on the input itself rather than on the label, because the panel
   * hides with a class: a `hidden` wrapper still submits its checkbox.
   */
  it("takes the self-guided box away once a course is chosen", async () => {
    loadOptions.mockResolvedValueOnce({
      courses: [{ id: "padi-ow", title: "Open Water Diver", agency: "padi", priceLabel: null }],
      diveSites: [],
    });
    const { container } = renderBuilder();

    const courseSelect = (await vi.waitFor(() => {
      const select = container.querySelector('select[name="courseId"]');
      if (!select) throw new Error("course selector is not mounted yet");
      return select;
    })) as HTMLSelectElement;

    // The box lives in the disclosed half of the panel, beside the course
    // picker it now depends on.
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));

    const selfGuided = () => container.querySelector('input[name="selfGuided"]');
    // Offered on a fun dive, which is what the panel opens as.
    expect(selfGuided()).not.toBeNull();
    expect((selfGuided() as HTMLInputElement).disabled).toBe(false);
    expect(selfGuided()?.closest(".hidden")).toBeNull();

    await userEvent.selectOptions(courseSelect, "padi-ow");
    // Both halves, because they fail differently: a `hidden` wrapper still
    // submits the checkbox it contains, so hiding without disabling would
    // leave the value posted and only the explanation missing.
    expect(selfGuided()?.closest(".hidden")).not.toBeNull();
    expect((selfGuided() as HTMLInputElement).disabled).toBe(true);

    // And back, because clearing the course makes the departure a fun dive
    // again — the rule is about course sessions, not about the mark.
    await userEvent.selectOptions(courseSelect, "");
    expect(selfGuided()?.closest(".hidden")).toBeNull();
    expect((selfGuided() as HTMLInputElement).disabled).toBe(false);
  });
});

/**
 * **The tide at the chosen site** (ADR 20260907-noaa-tide-predictions) is one
 * line under the site select, and it is that select's description: set the
 * way every field description is, under its own box, and read with it. A
 * paragraph after the fields put it in the first column at 14px, 22px under
 * a select standing in the second (pixel-craft K-337).
 */
describe("ScheduleBuilder add panel: the tide at the chosen site", () => {
  const days: FixtureDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];
  const TIDE = "Next high water at 9:12 AM; this departure reaches the site at 9:40 AM.";
  const loadTideWindow = vi.fn(async (_input: unknown): Promise<string | null> => TIDE);

  function renderBuilder() {
    return render(
      <ScheduleBuilder
        context={{
          shopSlug: "blue-mantis",
          week: weekFrom(days),
          loadOptions,
          loadMovePreflight,
          loadTideWindow,
          price: PRICE,
          actions,
          defaultDateIso: "2026-08-01",
          canConfigure: true,
          locale: "en-US",
          copy: COPY,
          more: MORE,
          initialCourse: null,
          openAdd: "quick",
        }}
      />,
    );
  }

  /** The text of every element a control's `aria-describedby` names. */
  const describedBy = (control: Element | null) =>
    (control?.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent ?? "");

  afterEach(() => {
    loadTideWindow.mockClear();
  });

  it("describes the site select with the tide, and dive one's once the form is expanded", async () => {
    const { container } = renderBuilder();
    await screen.findByRole("option", { name: "Molasses Reef" });
    const site = container.querySelector('select[name="diveSiteId"]') as HTMLSelectElement;
    // Nothing picked, nothing to say: no description, and nothing asked.
    expect(site.getAttribute("aria-describedby")).toBeNull();
    expect(loadTideWindow).not.toHaveBeenCalled();

    await userEvent.selectOptions(site, "site-1");
    await waitFor(() => expect(describedBy(site)).toEqual([TIDE]));
    for (const paragraph of container.querySelectorAll("form p")) {
      expect(paragraph).not.toHaveTextContent(TIDE);
    }
    // The select is also how the effect reaches its form: any change there
    // (the "when" is uncontrolled boxes) asks again.
    const asked = loadTideWindow.mock.calls.length;
    fireEvent.change(site.form as HTMLFormElement);
    expect(loadTideWindow).toHaveBeenCalledTimes(asked + 1);

    // Expanded, the day's site is dive one's select, so the line goes with it.
    await userEvent.click(screen.getByRole("button", { name: /More options/ }));
    expect(describedBy(container.querySelector('select[name="dive-1-siteId"]'))).toEqual([TIDE]);
    expect(
      container.querySelector('select[name="dive-2-siteId"]')?.getAttribute("aria-describedby"),
    ).toBeNull();
  });
});

/**
 * **The add panel already knows the weekday** (ADR 20260906-before-you-ask,
 * decision 3). The rule pinned: a panel opened plainly fills its own fields
 * from the weekday's pattern once the option lists are on screen and says so
 * in one line; the crew come as chips the desk can take off; "start blank"
 * empties what the pattern wrote; and a panel that arrived with a draft, a
 * course, or a site asks for no pattern at all.
 */
describe("ScheduleBuilder add panel: the weekday pattern", () => {
  const days: FixtureDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];
  const pattern = {
    weekday: 6,
    sampledDays: 6,
    fields: {
      startTime: "07:00",
      endTime: "10:30",
      title: "Two-Tank Reef",
      diveSiteId: "site-1",
      capacity: "10",
      priceDollars: "95",
    },
    crew: [
      { id: "keiko", name: "Keiko Tanaka" },
      { id: "sal", name: "Sal Moreno" },
    ],
    alsoUsual: { startTime: "13:00", timeLabel: "1:00 PM", title: "Wreck Trip", days: 4 },
  };
  const loadPattern = vi.fn(async (_dateIso: string) => pattern);

  function renderBuilder(extra: Partial<ScheduleBuilderContext> = {}) {
    return render(
      <ScheduleBuilder
        context={{
          shopSlug: "blue-mantis",
          week: weekFrom(days),
          loadOptions,
          loadMovePreflight,
          loadPattern,
          price: PRICE,
          actions,
          defaultDateIso: "2026-08-01",
          canConfigure: true,
          locale: "en-US",
          copy: COPY,
          more: MORE,
          initialCourse: null,
          openAdd: "quick",
          ...extra,
        }}
      />,
    );
  }

  afterEach(() => {
    loadPattern.mockClear();
  });

  it("fills the panel from the weekday, names the crew as chips, and offers the second boat", async () => {
    const { container } = renderBuilder();
    expect(loadPattern).toHaveBeenCalledWith("2026-08-01");

    expect(
      await screen.findByText("Filled from your last 6 Sat departures. Change anything, or"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("What is it")).toHaveValue("Two-Tank Reef");
    expect(screen.getByLabelText("Departs")).toHaveValue("7:00 AM");
    expect(container.querySelector('input[name="startTime"]')).toHaveValue("07:00");
    expect(container.querySelector('select[name="diveSiteId"]')).toHaveValue("site-1");
    expect(screen.getByLabelText(COPY.seats)).toHaveValue(10);
    expect(screen.getByLabelText(/Price per diver/)).toHaveValue(95);

    // The crew ride along as hidden fields, one per chip, and one line names them.
    expect(
      [...container.querySelectorAll('input[name="crewPersonIds"]')].map((el) =>
        el.getAttribute("value"),
      ),
    ).toEqual(["keiko", "sal"]);
    expect(screen.getByText("Keiko Tanaka and Sal Moreno crewed them.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove: Sal Moreno" }));
    expect(
      [...container.querySelectorAll('input[name="crewPersonIds"]')].map((el) =>
        el.getAttribute("value"),
      ),
    ).toEqual(["keiko"]);

    // The second departure is one row, off until ticked, carrying its start time.
    const also = screen.getByRole("checkbox", {
      name: /1:00 PM · Wreck Trip ran on 4 of those days too/,
    });
    expect(also).not.toBeChecked();
    expect(also).toHaveAttribute("name", "alsoUsualStart");
    expect(also).toHaveAttribute("value", "13:00");
  });

  it("does not overwrite the desk's edits when a weekday pattern arrives late", async () => {
    let resolvePattern!: (value: typeof pattern) => void;
    const delayed = new Promise<typeof pattern>((resolve) => {
      resolvePattern = resolve;
    });
    renderBuilder({ loadPattern: () => delayed });
    const title = await screen.findByLabelText("What is it");
    await userEvent.type(title, "My trip");
    await userEvent.clear(screen.getByLabelText(COPY.seats));
    await userEvent.type(screen.getByLabelText(COPY.seats), "6");
    await act(async () => {
      resolvePattern(pattern);
      await delayed;
    });
    expect(title).toHaveValue("My trip");
    expect(screen.getByLabelText(COPY.seats)).toHaveValue(6);
    expect(screen.queryByText(/Filled from your last/)).not.toBeInTheDocument();
  });

  it("starts blank on request: the fields empty, the crew gone, the line gone", async () => {
    const { container } = renderBuilder();
    await screen.findByText(/Filled from your last 6 Sat departures/);
    await userEvent.click(screen.getByRole("button", { name: "start blank" }));

    expect(screen.getByLabelText("What is it")).toHaveValue("");
    expect(container.querySelector('input[name="startTime"]')).toHaveValue("08:30");
    expect(container.querySelector('select[name="diveSiteId"]')).toHaveValue("");
    expect(container.querySelectorAll('input[name="crewPersonIds"]')).toHaveLength(0);
    expect(screen.queryByText(/Filled from your last/)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Wreck Trip/ })).not.toBeInTheDocument();
  });

  /**
   * "start blank" finishes the sentence that offers it ("…Change anything, or
   * start blank"), so it sits a word space after "or", not a word space and
   * a button's padding (pixel-craft K-223). A `px-0` handed through
   * `className` loses to the size's padding; `flush` is how a quiet button
   * lines up with the words around it.
   */
  it("sets start blank inside the sentence that offers it", async () => {
    renderBuilder();
    await screen.findByText(/Filled from your last 6 Sat departures/);
    expect(rendersFlush(screen.getByRole("button", { name: "start blank" }), "link", "sm")).toBe(
      true,
    );
  });

  it("asks for no pattern when the panel arrived with something to say already", async () => {
    renderBuilder({
      addDraft: { fields: { title: "Night dive" }, savedAtLabel: "4:12 PM" },
    });
    expect(await screen.findByLabelText("What is it")).toHaveValue("Night dive");
    expect(loadPattern).not.toHaveBeenCalled();

    cleanup();
    renderBuilder({
      openAdd: "quick",
      initialCourse: { id: "course-1", title: "Open Water Diver", requirement: "" },
    });
    expect(await screen.findByLabelText("What is it")).toBeInTheDocument();
    expect(loadPattern).not.toHaveBeenCalled();
  });
});

describe("ScheduleBuilder top add panel opened by link (?add=)", () => {
  const days: FixtureDay[] = [
    {
      dateIso: "2026-08-01",
      label: "Sat, Aug 1",
      parts: { weekday: "Sat", day: "1", month: "Aug" },
      trips: [],
    },
  ];
  const props = {
    shopSlug: "blue-mantis",
    days,
    loadOptions,
    price: PRICE,
    actions,
    defaultDateIso: "2026-08-01",
    canConfigure: true,
    copy: COPY,
    more: MORE,
    initialCourse: null,
    loadMovePreflight,
    locale: "en-US",
  } as const;

  it("opens when the openAdd prop changes after mount, so the header link works twice", async () => {
    // The header's "Add a departure" is a Link to `?add=1` on this same
    // route — a client navigation that re-renders this instance with a new
    // prop rather than remounting it. Without the prop-change effect the
    // link opened the panel exactly once per mount.
    const { rerender } = render(
      <ScheduleBuilder
        context={{
          ...props,
          openAdd: "closed",
        }}
      />,
    );
    expect(screen.queryByPlaceholderText(COPY.titlePlaceholder)).not.toBeInTheDocument();

    rerender(
      <ScheduleBuilder
        context={{
          ...props,
          openAdd: "quick",
        }}
      />,
    );
    expect(screen.getByPlaceholderText(COPY.titlePlaceholder)).toBeInTheDocument();
  });

  it("stays open through a StrictMode double-invoke, so a cross-route link lands on the form", () => {
    // Every door into this form from *another* route — the catalogue's
    // "schedule a session of this course", the `/trips/new` 308, a pasted
    // `?add=full` — arrives as a fresh mount carrying `openAdd`, and React
    // runs every effect twice on mount in development. The disarm-on-revisit
    // effect used to close unconditionally on its second pass, so the panel
    // opened and shut again before anyone saw it and the whole catalogue
    // button read as dead. StrictMode here reproduces that second pass.
    render(
      <StrictMode>
        <ScheduleBuilder
          context={{
            ...props,
            openAdd: "quick",
          }}
        />
      </StrictMode>,
    );
    expect(screen.getByPlaceholderText(COPY.titlePlaceholder)).toBeInTheDocument();
  });

  it("clears the opening params on Cancel, keeping the rest of the URL", async () => {
    // Not `...Once`: the mount renders more than once (the open-panel state
    // settles in an effect), and Cancel's closure reads the *latest* render's
    // params. afterEach restores the empty default.
    useSearchParams.mockReturnValue(new URLSearchParams("add=1&after=cursor-2"));
    render(
      <ScheduleBuilder
        context={{
          ...props,
          openAdd: "quick",
        }}
      />,
    );
    expect(screen.getByPlaceholderText(COPY.titlePlaceholder)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByPlaceholderText(COPY.titlePlaceholder)).not.toBeInTheDocument();
    expect(routerReplace).toHaveBeenCalledWith("/shop/blue-mantis/schedule/board?after=cursor-2", {
      scroll: false,
    });
  });
});

describe("ScheduleBuilder panel focus management (accessibility audit §3)", () => {
  it("opens the dated creation page when a day is chosen", async () => {
    const days: FixtureDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [],
      },
    ];
    render(
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
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Add a departure on Sat, Aug 1" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/schedule/board/new?date=2026-08-01&week=2026-08-01",
    );
  });

  it("returns to the selected week when creation is cancelled", async () => {
    render(
      <ScheduleBuilder
        context={{
          shopSlug: "blue-mantis",
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
          openAdd: "quick",
          createPage: true,
          returnWeek: "2026-07-27",
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(routerPush).toHaveBeenCalledWith("/shop/blue-mantis/schedule/board?week=2026-07-27");
  });

  it("moves focus into the move panel's date field on open, and back to the row's actions control on cancel", async () => {
    const days: FixtureDay[] = [
      {
        dateIso: "2026-08-01",
        label: "Sat, Aug 1",
        parts: { weekday: "Sat", day: "1", month: "Aug" },
        trips: [baseTrip()],
      },
    ];
    render(
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
        }}
      />,
    );

    const trigger = screen.getByRole("button", { name: /^Move, copy, or remove Two-Tank Reef/ });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("button", { name: /^Move Two-Tank Reef/ }));
    expect(screen.getByLabelText(COPY.newDate)).toHaveFocus();

    // The Move item lives inside the now-closed menu, so Cancel hands focus to
    // the control that is actually still on screen: the row's "⋯" trigger.
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText(COPY.newDate)).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
