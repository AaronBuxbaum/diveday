// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CourseSelect,
  DayKindSelects,
  DescriptionAndPrivacy,
  PanelFooter,
  PatternCrew,
  PatternNote,
  PayAtBookingGroup,
  PriceInputGroup,
  RequestPlanBrief,
} from "./add-panel-groups";
import type { BuilderCopy, BuilderOptions } from "./builder-types";

afterEach(cleanup);

/** Every word is its own key, so a test names the control it means. */
const COPY = new Proxy({} as BuilderCopy, {
  get: (_, key) => (key === "courseAgencyLabels" ? { padi: "PADI", other: "Other" } : String(key)),
});
const PRICE = { step: "0.01", max: 100_000, placeholder: "$0.00" };
const OPTIONS: BuilderOptions = {
  courses: [
    {
      id: "c1",
      title: "Open Water",
      agency: "PADI",
      priceLabel: "$250.00 per diver, the course’s price",
    },
    { id: "c2", title: "Rescue", agency: "", priceLabel: null },
  ],
  diveSites: [],
  boats: [{ id: "b1", name: "Mantis II", capacity: 14 }],
  lenses: [{ id: "l1", title: "Night" }],
};

describe("PayAtBookingGroup", () => {
  it("leaves the submission while collapsed, and offers its four boxes when open", () => {
    const { container, rerender } = render(
      <PayAtBookingGroup copy={COPY} price={PRICE} expanded={false} />,
    );
    const group = container.querySelector("fieldset");
    expect(group?.hidden).toBe(true);
    expect(group?.disabled).toBe(true);
    rerender(<PayAtBookingGroup copy={COPY} price={PRICE} expanded={true} />);
    for (const name of [
      "depositDollars",
      "cancellationWindowHours",
      "minimumBookings",
      "minimumDecisionHours",
    ]) {
      expect(container.querySelector(`input[name="${name}"]`), name).not.toBeNull();
    }
    expect(container.querySelector("fieldset")?.disabled).toBe(false);
  });
});

describe("PriceInputGroup", () => {
  it("shows the catalog course price without submitting a separate trip price", () => {
    const { container } = render(
      <PriceInputGroup
        copy={COPY}
        price={PRICE}
        coursePriceLabel="$250.00 per diver, the course’s price"
      />,
    );
    expect(screen.getByText("$250.00 per diver, the course’s price")).toBeTruthy();
    const input = container.querySelector<HTMLInputElement>('input[name="priceDollars"]');
    expect(input?.hidden).toBe(true);
    expect(input?.disabled).toBe(true);
  });
});

describe("CourseSelect", () => {
  it("groups courses under their agency, a blank agency under Other", () => {
    render(
      <CourseSelect
        copy={COPY}
        options={OPTIONS}
        initialCourse={null}
        onCourse={false}
        courseId=""
        setCourseId={vi.fn()}
      />,
    );
    expect(screen.getByRole("group", { name: "PADI" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Other" })).toBeTruthy();
  });

  it("keeps the course it was opened for while the catalogue is in flight", () => {
    render(
      <CourseSelect
        copy={COPY}
        options={null}
        initialCourse={{ id: "c9", title: "Deep", requirement: "Advanced" } as never}
        onCourse={true}
        courseId="c9"
        setCourseId={vi.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: "Deep" })).toBeTruthy();
    // No "Loading…" option: the box pulses, busy, and says no word (A33).
    expect(screen.queryByRole("option", { name: /loading/i })).toBeNull();
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-busy", "true");
  });
});

describe("PatternCrew and PatternNote", () => {
  it("say nothing without a pattern or a crew", () => {
    const { container } = render(
      <>
        <PatternCrew copy={COPY} crew={[]} setCrew={vi.fn()} crewNames="" />
        <PatternNote copy={COPY} pattern={null} weekdayNames={[]} startBlank={vi.fn()} />
      </>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("posts each usual crew member and lets one be removed", () => {
    const setCrew = vi.fn();
    const { container } = render(
      <PatternCrew
        copy={COPY}
        crew={[{ id: "p1", name: "Keiko" }]}
        setCrew={setCrew}
        crewNames="Keiko"
      />,
    );
    expect(container.querySelector('input[name="crewPersonIds"]')?.getAttribute("value")).toBe(
      "p1",
    );
    fireEvent.click(screen.getByRole("button", { name: "remove: Keiko" }));
    expect(setCrew).toHaveBeenCalledTimes(1);
  });
});

describe("RequestPlanBrief", () => {
  it("ticks every request it was opened for", () => {
    render(
      <RequestPlanBrief
        copy={COPY}
        requestPlan={{
          estimatedDivers: 3,
          suggestedCapacity: 4,
          suggestedDivemasters: 0,
          diversPerDivemaster: 6,
          requests: [
            { id: "r1", name: "Ana", subject: "Wreck day", divers: 2 },
            { id: "r2", name: "Ben", subject: "Night dive", divers: 1 },
          ],
        }}
      />,
    );
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[name="interestId"]')];
    expect(boxes.map((box) => [box.value, box.checked])).toEqual([
      ["r1", true],
      ["r2", true],
    ]);
  });
});

describe("DayKindSelects", () => {
  it("submits a single mode rather than asking", () => {
    const { container } = render(
      <DayKindSelects
        copy={COPY}
        options={{ courses: [], diveSites: [] }}
        offeredModes={["boat"]}
        diveMode="boat"
        setDiveMode={vi.fn()}
        selectedBoatId=""
        setSelectedBoatId={vi.fn()}
        setCapacity={vi.fn()}
        lensId=""
        setLensId={vi.fn()}
      />,
    );
    const mode = container.querySelector<HTMLInputElement>('input[name="diveMode"]');
    expect(mode?.type).toBe("hidden");
    expect(mode?.value).toBe("boat");
  });

  it("takes a picked boat's capacity as the seat count", () => {
    const setCapacity = vi.fn();
    const { container } = render(
      <DayKindSelects
        copy={COPY}
        options={OPTIONS}
        offeredModes={["boat", "shore"]}
        diveMode="boat"
        setDiveMode={vi.fn()}
        selectedBoatId=""
        setSelectedBoatId={vi.fn()}
        setCapacity={setCapacity}
        lensId=""
        setLensId={vi.fn()}
      />,
    );
    const boat = container.querySelector('select[name="boatId"]') as HTMLSelectElement;
    fireEvent.change(boat, { target: { value: "b1" } });
    expect(setCapacity).toHaveBeenCalledWith(14);
    expect(container.querySelector('select[name="lensId"]')).not.toBeNull();
  });
});

describe("DescriptionAndPrivacy and PanelFooter", () => {
  it("disable the expanded-only controls while collapsed", () => {
    const { container } = render(<DescriptionAndPrivacy copy={COPY} expanded={false} />);
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[name="description"]')?.disabled,
    ).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[name="isPrivate"]')?.disabled).toBe(
      true,
    );
  });

  it("toggles the depth and hands Cancel back", () => {
    const toggle = vi.fn();
    const cancel = vi.fn();
    render(<PanelFooter copy={COPY} expanded={false} toggleExpanded={toggle} onCancel={cancel} />);
    fireEvent.click(screen.getByRole("button", { name: /moreOptions/ }));
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
