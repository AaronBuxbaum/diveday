// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonClass } from "./button";
import { ForgivingInput } from "./ForgivingInput";
import {
  ChoiceFieldset,
  ChoicePill,
  ChoiceRow,
  choiceClass,
  controlClass,
  controlClassFor,
  DateField,
  Field,
  FieldActions,
  FieldGrid,
  FormStatus,
  legendClass,
  PriceField,
  SearchField,
  StickyFormActions,
  textareaClassFor,
} from "./form";

afterEach(cleanup);

const COPY = { typedAs: "typed as \u201c{raw}\u201d" };

/**
 * The two halves of "a refusal belongs where the work is": `Field`'s `error`
 * puts it on the control, `FormStatus` puts it in the action row. Both are
 * wired for assistive tech, which is the part a screenshot cannot check.
 */
describe("SearchField", () => {
  it("is a named searchbox with the magnifier inset and no caption or button", () => {
    const { container } = render(
      <SearchField id="site-search" name="q" label="Find a site" placeholder="Name or location" />,
    );
    const box = screen.getByRole("searchbox", { name: "Find a site" });
    // The name is there for a screen reader and nowhere else: the glyph and
    // the placeholder already say "search" to a sighted reader.
    expect(screen.getByText("Find a site")).toHaveClass("sr-only");
    expect(box).toHaveAttribute("type", "search");
    expect(box).toHaveClass("ps-9");
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("passes every native prop through, so a surface never spells the box by hand", () => {
    render(
      <SearchField
        id="orders-search"
        name="q"
        label="Search orders"
        defaultValue="reef"
        data-hydrated="true"
      />,
    );
    const box = screen.getByRole("searchbox", { name: "Search orders" });
    expect(box).toHaveValue("reef");
    expect(box).toHaveAttribute("data-hydrated", "true");
    expect(box).toHaveAttribute("name", "q");
  });

  it("stands at md's 48px beside an md button, and at the 44px floor anywhere else", () => {
    render(
      <>
        <SearchField id="orders-search" label="Search orders" />
        <SearchField id="diverq-search" label="Find a diver" size="md" />
      </>,
    );
    const alone = screen.getByRole("searchbox", { name: "Search orders" });
    const beside = screen.getByRole("searchbox", { name: "Find a diver" });
    expect(alone).toHaveClass("min-h-11");
    expect(beside).toHaveClass("min-h-12", "ps-9");
    expect(beside).not.toHaveClass("min-h-11");
  });
});

/** The px a Tailwind spacing step names: `min-h-12` is 48, `py-2.5` is 10. */
function stepPx(tokens: string[], prefix: string): number {
  const token = tokens.find((one) => one.startsWith(prefix));
  expect(token, `${prefix}* in ${tokens.join(" ")}`).toBeDefined();
  return Number(token?.slice(prefix.length)) * 4;
}

/**
 * **A text control on a line with buttons stands at their size** — the pixel
 * probe's `mismatched-controls` cluster on 2026-09-25: a 44px search box beside
 * a 48px "Add diver" on seventeen trip captures and the roster, and a 16px box
 * beside a 14px "Go" or "Save" wherever a row paired one with `sm`. A control's
 * type is 16px and stays there, so `md`, the one button rung with a 16px label,
 * is what it can stand level with, and `controlClassFor("md")` is how it
 * reaches that rung's height.
 */
describe("controlClassFor", () => {
  it("stands an md control level with an md button, in height and in type", () => {
    const control = controlClassFor("md").split(/\s+/);
    const button = buttonClass().split(/\s+/);
    expect(control).toContain("min-h-12");
    expect(button).toContain("min-h-12");
    expect(control).not.toContain("min-h-11");
    expect(control).toContain("text-base");
    expect(button).toContain("text-base");
  });

  it("keeps the stacked field's control at the 44px floor, as `controlClass`", () => {
    expect(controlClassFor("field")).toBe(controlClass);
    expect(controlClass.split(/\s+/)).toContain("min-h-11");
    expect(controlClass.split(/\s+/)).not.toContain("min-h-12");
  });

  it("grows the padding with the height, so a control that does not centre itself still sits centred", () => {
    // A text box centres its line at any height; a native file picker lays its
    // button at the top of the content box. The same content box at every size
    // puts the extra height equally above and below either one.
    const contentBox = (classes: string) => {
      const tokens = classes.split(/\s+/);
      const border = tokens.includes("border") ? 2 : 0;
      return stepPx(tokens, "min-h-") - 2 * stepPx(tokens, "py-") - border;
    };
    expect(contentBox(controlClassFor("md"))).toBe(contentBox(controlClassFor("field")));
  });

  /**
   * A placeholder longer than its box was cut mid-word at the padding edge:
   * "…along the c" at 390 on the dive-site editor (K-129). The ellipsis says
   * there is more; a cut says the box is broken.
   */
  it("ends an overlong placeholder in an ellipsis at every size", () => {
    for (const size of ["field", "md"] as const) {
      expect(controlClassFor(size).split(/\s+/), size).toContain("placeholder-shown:text-ellipsis");
    }
  });

  it("spells each size's height and padding once, so nothing is left to stylesheet order", () => {
    for (const size of ["field", "md"] as const) {
      const tokens = controlClassFor(size).split(/\s+/);
      expect(
        tokens.filter((one) => one.startsWith("min-h-")),
        size,
      ).toHaveLength(1);
      expect(
        tokens.filter((one) => one.startsWith("py-")),
        size,
      ).toHaveLength(1);
    }
  });
});

/**
 * **A textarea grows with what is in it.** Every textarea picked a fixed
 * `rows` for a typical value, so a longer one scrolled inside its box and its
 * next line showed as a sliver on the bottom border: the course FAQ answer
 * (1,200 characters, three rows) with a fourth line's ink 2px above the
 * border at 390, the seasons notes (280 characters, two rows) with a third
 * line's ascenders on it (K-46). `field-sizing: content` grows the box; the
 * minimum keeps today's rows, so an empty box is no smaller than it was.
 */
describe("textareaClassFor", () => {
  it("grows with its content and never stands shorter than its rows", () => {
    const tokens = textareaClassFor(3).split(/\s+/);
    expect(tokens).toContain("field-sizing-content");
    // Three lines of the box's own line-height, and py-2 (16px) plus the
    // border (2px) around them.
    expect(tokens).toContain("min-h-[calc(3lh+1.125rem)]");
    expect(textareaClassFor(2).split(/\s+/)).toContain("min-h-[calc(2lh+1.125rem)]");
  });

  it("is the control's body, and spells one minimum height and one padding", () => {
    const tokens = textareaClassFor(4).split(/\s+/);
    for (const shared of controlClass.split(/\s+/).filter((token) => !token.startsWith("min-h-")))
      expect(tokens).toContain(shared);
    expect(tokens.filter((token) => token.startsWith("min-h-"))).toHaveLength(1);
    expect(tokens.filter((token) => token.startsWith("py-"))).toHaveLength(1);
  });

  /**
   * **It grows to a screenful and no further.** Unbounded, the waiver editor
   * (14 rows, 12,000 characters allowed) opens on the default release, about
   * 5,700 characters, and grew to roughly 80 lines at 1280 — Publish and the
   * materiality choice a thousand pixels below where they sat under a 14-row
   * box; the course overview did the same (K-46 review). Past 60% of the
   * viewport's height the box scrolls, which is still more of the text than
   * the fixed rows showed. A minimum taller than the cap (14 rows on a short
   * landscape phone) wins, as CSS has it.
   */
  it("stops growing at a screenful, and scrolls past it", () => {
    for (const rows of [2, 3, 4, 6, 8, 14] as const) {
      const tokens = textareaClassFor(rows).split(/\s+/);
      expect(tokens).toContain("max-h-[60svh]");
      expect(tokens.filter((token) => token.startsWith("max-h-"))).toHaveLength(1);
    }
  });
});

describe("DateField", () => {
  it("is a date input the label reaches through its positioning wrapper", () => {
    // The wrapper is the whole reason this needs a test: `Field` clones the
    // minted id onto `children`, and a wrapper that swallowed it would leave
    // the label pointing at an id nothing carries. Every e2e spec that fills
    // a date does it `getByLabel`, and would find this out as a timeout.
    render(
      <Field label="Preferred date">
        <DateField name="preferredDate" />
      </Field>,
    );
    const box = screen.getByLabelText("Preferred date");
    expect(box).toHaveAttribute("type", "date");
    expect(box).toHaveAttribute("name", "preferredDate");
  });

  it("marks a required date the same way every other control is marked", () => {
    // Goes red exactly when `DateField` is dropped from `Field`'s `isControl`
    // set, which is otherwise a silent regression across thirteen fields.
    render(
      <Field label="Sails on">
        <DateField name="startsOn" required />
      </Field>,
    );
    expect(screen.getByText("*")).toBeInTheDocument();
    expect(screen.getByLabelText("Sails on")).toBeRequired();
  });

  it("carries the field's description and error onto the input, not the wrapper", () => {
    render(
      <Field
        label="Serviced on"
        description="The last time it went to the bench"
        error="Not a date"
      >
        <DateField name="servicedOn" />
      </Field>,
    );
    const box = screen.getByLabelText("Serviced on");
    expect(box).toHaveAccessibleDescription(/last time it went to the bench/);
    expect(box).toHaveAccessibleDescription(/Not a date/);
    expect(box).toHaveAttribute("aria-invalid", "true");
  });

  it("hides the platform indicator by opacity, never by display", () => {
    // `display: none` would take Chromium's picker tap target away with the
    // pixels and leave our glyph looking live and doing nothing. Hidden by
    // opacity it stays in the layout underneath, which is what `pe-9` and the
    // glyph's `end-3` are sized against.
    const { container } = render(<DateField name="on" />);
    const box = screen.getByDisplayValue("");
    expect(box.className).toContain("[&::-webkit-calendar-picker-indicator]:opacity-0");
    expect(box.className).not.toContain("calendar-picker-indicator]:hidden");
    expect(box).toHaveClass("pe-9");
    const glyph = container.querySelector("svg");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph).toHaveClass("pointer-events-none");
  });

  /**
   * **Every temporal box wears the house glyph, not only a date.** A month,
   * time or date-and-time box kept the platform's solid black indicator,
   * further in than the date box's muted outline beside it, and iOS paints
   * nothing at all in an empty one (K-54, issue #1415). A time takes a clock.
   */
  it("draws the house glyph for a month, a time and a date-and-time as well", () => {
    for (const type of ["month", "time", "datetime-local"] as const) {
      const { container, unmount } = render(<DateField type={type} name="when" />);
      const box = container.querySelector("input");
      expect(box, type).toHaveAttribute("type", type);
      expect(box?.className, type).toContain("[&::-webkit-calendar-picker-indicator]:opacity-0");
      const glyph = container.querySelector("svg");
      expect(glyph, type).toHaveAttribute("aria-hidden", "true");
      // A clock for a time, a calendar for anything with a day or a month in it.
      expect(Boolean(glyph?.querySelector("circle")), type).toBe(type === "time");
      unmount();
    }
    const { container } = render(<DateField name="on" />);
    expect(container.querySelector("input")).toHaveAttribute("type", "date");
  });

  /**
   * **No glyph where there is no picker.** Safari and Firefox on a desk have
   * no month control: `type="month"` falls back to a text box reading
   * "2026-09", and a calendar glyph over it promises a picker that never
   * opens (K-54 review). A browser that downgrades the type reads it back as
   * `text`; the box says so, and the glyph and its inset go.
   */
  it("drops the glyph where the browser has no such control", () => {
    const real = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "type");
    const spy = vi.spyOn(HTMLInputElement.prototype, "type", "get").mockImplementation(function (
      this: HTMLInputElement,
    ) {
      return this.getAttribute("type") === "month" ? "text" : real?.get?.call(this);
    });
    try {
      const { container } = render(<DateField type="month" name="month" aria-label="Month" />);
      const box = screen.getByLabelText("Month");
      expect(box).toHaveAttribute("data-fallback");
      expect(box).toHaveClass("peer", "data-[fallback]:pe-3");
      expect(container.querySelector("svg")).toHaveClass("peer-data-[fallback]:hidden");
    } finally {
      spy.mockRestore();
    }
    render(<DateField type="month" name="month" aria-label="A month box that exists" />);
    expect(screen.getByLabelText("A month box that exists")).not.toHaveAttribute("data-fallback");
  });

  it("stands at md's 48px beside an md button, and at the field's 44px anywhere else", () => {
    const { container } = render(
      <>
        <DateField type="month" name="month" size="md" />
        <DateField name="on" />
      </>,
    );
    const [beside, stacked] = container.querySelectorAll("input");
    expect(beside).toHaveClass("min-h-12", "pe-9");
    expect(beside).not.toHaveClass("min-h-11");
    expect(stacked).toHaveClass("min-h-11");
  });

  /**
   * **An empty date box looks empty.** A date input never matches
   * `::placeholder`, so an empty one drew its `mm/dd/yyyy` mask in the
   * input's own ink — `#1d1d1f`, the colour of the filled "How many divers: 1"
   * beside it — while the real placeholders on the form were `#88888c`
   * (schedule-off-season, took-a-call; K-69). The box says whether it is
   * empty, and the stylesheet paints the mask in the placeholder's colour.
   */
  it("says it is empty until it holds a date, as the person types", () => {
    render(<DateField name="preferredDate" aria-label="Preferred date" />);
    const box = screen.getByLabelText("Preferred date");
    expect(box).toHaveAttribute("data-empty");
    fireEvent.input(box, { target: { value: "2026-10-01" } });
    expect(box).not.toHaveAttribute("data-empty");
    fireEvent.input(box, { target: { value: "" } });
    expect(box).toHaveAttribute("data-empty");
  });

  /**
   * **A half-typed date is not an empty one.** A temporal box's value stays
   * "" until every segment is filled, so "09/dd/yyyy" still read as empty and
   * the typed "09" drew in the placeholder's grey (K-69 review). The mask
   * takes the ink while the box has focus (the stylesheet's `:not(:focus)`),
   * and a box left half-typed — `validity.badInput` — stops saying it is
   * empty.
   */
  it("stops calling a half-typed box empty once the person leaves it", () => {
    render(<DateField name="on" aria-label="On" />);
    const box = screen.getByLabelText("On");
    Object.defineProperty(box, "validity", { configurable: true, value: { badInput: true } });
    fireEvent.blur(box);
    expect(box).not.toHaveAttribute("data-empty");
    Object.defineProperty(box, "validity", { configurable: true, value: { badInput: false } });
    fireEvent.blur(box);
    expect(box).toHaveAttribute("data-empty");
  });

  it("reads a prefilled or controlled value, and follows a form reset", async () => {
    const { rerender } = render(
      <form>
        <DateField name="on" aria-label="On" defaultValue="2026-07-25" />
        <DateField name="at" aria-label="At" type="time" value="" onChange={() => {}} />
      </form>,
    );
    expect(screen.getByLabelText("On")).not.toHaveAttribute("data-empty");
    expect(screen.getByLabelText("At")).toHaveAttribute("data-empty");
    rerender(
      <form>
        <DateField name="on" aria-label="On" defaultValue="2026-07-25" />
        <DateField name="at" aria-label="At" type="time" value="07:30" onChange={() => {}} />
      </form>,
    );
    expect(screen.getByLabelText("At")).not.toHaveAttribute("data-empty");

    const on = screen.getByLabelText("On") as HTMLInputElement;
    fireEvent.input(on, { target: { value: "" } });
    expect(on).toHaveAttribute("data-empty");
    on.form?.reset();
    expect(on).toHaveValue("2026-07-25");
    await waitFor(() => expect(on).not.toHaveAttribute("data-empty"));
  });

  it("hands a caller's ref the box once, not again on every keystroke", () => {
    // The schedule builder focuses a date box through its ref; a ref handed
    // over again on each re-render would pull focus back on every one.
    const calls: (HTMLInputElement | null)[] = [];
    const focusOnMount = (node: HTMLInputElement | null) => {
      calls.push(node);
    };
    render(<DateField name="on" aria-label="On" ref={focusOnMount} />);
    const box = screen.getByLabelText("On");
    fireEvent.input(box, { target: { value: "2026-10-01" } });
    fireEvent.input(box, { target: { value: "" } });
    expect(calls).toEqual([box]);
  });

  it("paints an empty box's mask in the placeholder's colour", () => {
    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const placeholder = css.match(
      /input::placeholder,\s*textarea::placeholder\s*\{\s*color:\s*([^;]+);/,
    )?.[1];
    expect(placeholder).toBeDefined();
    // Not while the box has focus: the person's own digits take the ink.
    const mask = css.match(
      /input\[data-empty\]:not\(:focus\)::-webkit-datetime-edit\s*\{\s*color:\s*([^;]+);/,
    );
    expect(mask, "input[data-empty]:not(:focus)::-webkit-datetime-edit { color }").not.toBeNull();
    expect(mask?.[1]).toBe(placeholder);
  });

  it("passes every native prop through, including a callback ref", () => {
    // The schedule builder focuses a date box on mount; a wrapper that ate the
    // ref would break that with nothing failing.
    let focused: HTMLInputElement | null = null;
    render(
      <DateField
        name="on"
        defaultValue="2026-07-25"
        min="2026-07-01"
        max="2026-08-31"
        className="tabular-nums"
        ref={(node) => {
          focused = node;
        }}
      />,
    );
    const box = screen.getByDisplayValue("2026-07-25");
    expect(box).toHaveAttribute("min", "2026-07-01");
    expect(box).toHaveAttribute("max", "2026-08-31");
    expect(box).toHaveClass("tabular-nums");
    expect(focused).toBe(box);
  });
});

/**
 * **One currency symbol, and the box on its caption's edge.** PriceField used
 * to print the symbol in a prefix beside a money box that already settles to
 * "$45", so a price read "$ $45", and the prefix pushed the box 17px right of
 * its label where every other control starts on its own (settings-payments at
 * 1280: prefix ink 450–456, box border at 466, caption at 449; K-90).
 */
describe("PriceField", () => {
  it("prints the symbol once, in the box, with the box as the field's own control", () => {
    render(
      <PriceField
        id="price"
        name="priceCents"
        label="Price"
        cents={4500}
        currency="USD"
        locale="en-US"
        copy={COPY}
      />,
    );
    const box = screen.getByLabelText("Price");
    expect(box).toHaveValue("$45");
    // Field's control slot holds the forgiving box itself — no prefix span, no
    // flex row beside it.
    const slot = box.closest("span.grid");
    expect(slot?.textContent).not.toMatch(/^\$/);
    expect(slot?.querySelectorAll("span.text-muted")).toHaveLength(0);
    expect(screen.queryByText("$")).toBeNull();
  });

  it("carries the symbol in an empty box's placeholder", () => {
    render(
      <PriceField
        name="depositCents"
        label="Deposit"
        cents={null}
        currency="EUR"
        locale="en-US"
        copy={COPY}
      />,
    );
    expect(screen.getByLabelText("Deposit")).toHaveAttribute("placeholder", "€");
  });
});

/**
 * **One checkbox, one radio, one row and one pill.** There was no shared
 * choice primitive, so each site drew its own: radios left at the platform's
 * 13px beside 16px checkboxes (waiver-active: radio ink 13×13 in its pill,
 * the page's checkbox 16×16), `size-4` boxes without `shrink-0` that squashed
 * beside a wrapped label, label rows with no 44px floor, and the bordered
 * answer pill spelled four ways (K-13).
 */
describe("ChoicePill and ChoiceRow", () => {
  it("draws the box at 16px and never lets a long label squash it", () => {
    expect(choiceClass.split(/\s+/)).toEqual(expect.arrayContaining(["size-4", "shrink-0"]));
  });

  it("puts a 16px radio in a 44px bordered pill, named by its words", () => {
    render(
      <ChoicePill type="radio" name="outcome" value="cleared" required>
        Cleared to dive
      </ChoicePill>,
    );
    const radio = screen.getByRole("radio", { name: "Cleared to dive" });
    expect(radio).toHaveAttribute("name", "outcome");
    expect(radio).toHaveAttribute("value", "cleared");
    expect(radio).toBeRequired();
    expect(radio).toHaveClass("size-4", "shrink-0");
    // The box centres on the first line of the words, however they wrap.
    expect(radio.parentElement).toHaveClass("h-lh", "items-center");
    const pill = radio.closest("label");
    expect(pill).toHaveClass(
      "min-h-11",
      "rounded-lg",
      "border",
      "px-4",
      "text-sm",
      "hover:bg-surface-sunken",
    );
  });

  it("sets a diver-facing pill's words at 16px when asked", () => {
    render(
      <ChoicePill type="radio" name="q1" value="yes" size="md">
        Yes
      </ChoicePill>,
    );
    const pill = screen.getByRole("radio", { name: "Yes" }).closest("label");
    expect(pill).toHaveClass("text-base");
    expect(pill).not.toHaveClass("text-sm");
  });

  /**
   * **A pill with something beside its words keeps one box column.** A rental
   * item carries an explainer and a price, which must stay outside the label
   * (a label's text is the box's name, and a click on a button inside one
   * toggles the box). Those pills were a bordered `<div>` around a label,
   * spelled by hand at `pl-3 gap-3` beside the nitrox `ChoicePill`'s `px-4
   * gap-x-2`, so the boxes in one form stood 4px apart and only one pill had
   * the fill and the hover (RentalFitForm, K-13 review).
   */
  it("keeps an aside outside the label, with the box where a plain pill puts it", () => {
    render(
      <ChoicePill
        type="checkbox"
        name="fins"
        checked={false}
        onChange={() => {}}
        aside={
          <>
            <button type="button">What are fins?</button>
            <span>$8</span>
          </>
        }
      >
        Fins
      </ChoicePill>,
    );
    const box = screen.getByRole("checkbox", { name: "Fins" });
    expect(box).toHaveAttribute("name", "fins");
    expect(box).toHaveClass("size-4", "shrink-0");
    const label = box.closest("label");
    expect(label).not.toContainElement(screen.getByRole("button", { name: "What are fins?" }));
    expect(label).not.toHaveTextContent("$8");
    // The box's inset and the words' gap are the plain pill's.
    expect(label).toHaveClass("ps-4", "gap-x-2", "flex-1");
    const pill = label?.parentElement;
    expect(pill).toHaveClass(
      "min-h-11",
      "rounded-lg",
      "border",
      "bg-surface",
      "pe-4",
      "text-sm",
      "hover:bg-surface-sunken",
    );
    expect(pill).toContainElement(screen.getByRole("button", { name: "What are fins?" }));
  });

  it("puts a 16px checkbox on the first line of a 44px row, and passes every input prop", () => {
    let node: HTMLInputElement | null = null;
    render(
      <ChoiceRow
        type="checkbox"
        id="acknowledged"
        name="acknowledged"
        value="on"
        defaultChecked
        aria-describedby="acknowledged-error"
        aria-invalid="true"
        required
        className="text-base"
        ref={(input) => {
          node = input;
        }}
      >
        I have read and agree to the release above, which runs to several lines.
      </ChoiceRow>,
    );
    const box = screen.getByRole("checkbox", { name: /I have read and agree/ });
    expect(box).toBeChecked();
    expect(box).toHaveAttribute("id", "acknowledged");
    // The waiver's refusal wiring rides on these: a refused agreement is
    // announced as invalid and pointed at its message, and stays required.
    expect(box).toHaveAttribute("aria-describedby", "acknowledged-error");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(box).toBeRequired();
    expect(box).toHaveClass("size-4", "shrink-0");
    expect(box.parentElement).toHaveClass("h-lh", "items-center");
    expect(box.closest("label")).toHaveClass("min-h-11", "items-start", "text-base");
    expect(node).toBe(box);
  });
});

/**
 * **A group of choices is captioned the way a field is.** A `Field` puts 4px
 * between its caption and its control; hand-rolled legends put 8px (`mb-2`,
 * `mt-2`), so on one page "Catch Hook URL" sat 9px above its box and "Events
 * to send" 13px above its pills, and on the call form "What they wanted" sat
 * 4px further from its choices than every caption around it (K-72).
 */
describe("ChoiceFieldset", () => {
  it("captions its choices like a field: text-sm, then 4px, then the body", () => {
    render(
      <ChoiceFieldset legend="Events to send" bodyClassName="grid gap-2 sm:grid-cols-3">
        <ChoicePill type="checkbox" name="eventType" value="booking.created">
          Booking made
        </ChoicePill>
      </ChoiceFieldset>,
    );
    const group = screen.getByRole("group", { name: "Events to send" });
    const legend = group.querySelector("legend");
    expect(legend).toHaveClass("text-sm", "font-medium");
    expect(legend?.className).not.toMatch(/\bm[bty]?-/);
    const body = legend?.nextElementSibling;
    expect(body).toHaveClass("mt-1", "grid", "gap-2");
    expect(body?.className.split(/\s+/).filter((token) => /^-?m[tbyxse]?-/.test(token))).toEqual([
      "mt-1",
    ]);
    expect(screen.getByRole("checkbox", { name: "Booking made" })).toBeInTheDocument();
  });

  it("marks a required group the way Field marks a required control, outside its name", () => {
    render(
      <ChoiceFieldset legend="Outcome" required className="mt-6">
        <ChoicePill type="radio" name="outcome" value="cleared" required>
          Cleared
        </ChoicePill>
      </ChoiceFieldset>,
    );
    const group = screen.getByRole("group", { name: "Outcome" });
    expect(group).toHaveClass("mt-6");
    expect(screen.getByText("*")).toHaveAttribute("aria-hidden", "true");
  });

  it("passes the fieldset's own props through, so a group can listen and be disabled", () => {
    render(
      <ChoiceFieldset legend="Departure" disabled data-testid="departure">
        <ChoicePill type="radio" name="tripId" value="t1">
          Saturday
        </ChoicePill>
      </ChoiceFieldset>,
    );
    expect(screen.getByTestId("departure")).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Saturday" })).toBeDisabled();
  });
});

describe("Field error", () => {
  it("renders nothing and wires nothing when the field is fine", () => {
    render(
      <Field label="Name">
        <input name="name" className={controlClass} />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("announces the refusal and points the control at it", () => {
    render(
      <Field label="Name" error="Give the site a name.">
        <input name="name" className={controlClass} />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Give the site a name.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    // The message is *the* description of the control, not a sibling a screen
    // reader has to be told about separately.
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(alert.id);
  });

  /**
   * A description can be a component that has nothing to say yet: the
   * onboarding form's storefront link says nothing until there is a slug to
   * show. Its slot rendered anyway, empty, and still took the body's 4px gap
   * under the control (the pixel probe, onboard). The slot stays mounted, so
   * `aria-describedby` keeps a target, and hides itself while it is empty.
   */
  it("keeps a description that renders nothing out of the field's column", () => {
    function NothingYet() {
      return null;
    }
    render(
      <Field label="Shop link" description={<NothingYet />}>
        <input name="shopSlug" />
      </Field>,
    );
    const input = screen.getByLabelText("Shop link");
    const description = document.getElementById(`${input.id}-description`);
    expect(description).toBeEmptyDOMElement();
    expect(description).toHaveClass("empty:hidden");
  });

  it("keeps the helper description alongside the refusal", () => {
    render(
      <Field label="Depth" description="Metres, to the nearest metre." error="Too deep.">
        <input name="depth" className={controlClass} />
      </Field>,
    );
    const input = screen.getByLabelText("Depth");
    const described = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(described).toHaveLength(2);
    expect(screen.getByText("Metres, to the nearest metre.").id).toBe(described[0]);
    expect(screen.getByRole("alert").id).toBe(described[1]);
  });

  it("never clears an aria-invalid the caller set itself", () => {
    render(
      <Field label="Email">
        <input name="email" aria-invalid="true" className={controlClass} />
      </Field>,
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("merges with an aria-describedby the caller already set", () => {
    render(
      <Field label="Code" error="Already taken.">
        <input name="code" aria-describedby="house-rules" className={controlClass} />
      </Field>,
    );
    const described =
      screen.getByLabelText("Code").getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(described[0]).toBe("house-rules");
    expect(described).toContain(screen.getByRole("alert").id);
  });

  it("still shows the refusal for a field wrapping something other than one control", () => {
    // The documented fallback: a `Field` whose children are a wrapper div fall
    // back to label-wraps-everything, and must not silently drop the message.
    render(
      <Field label="Price" error="Enter a price.">
        <div>
          <span>$</span>
          <input name="price" className={controlClass} />
        </div>
      </Field>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a price.");
  });
});

/**
 * A child that is not a native control has no id to clone onto, so `Field`
 * associates its caption by *wrapping* — except when the caller names the
 * control with `htmlFor`, where wrapping would put one `<label>` inside
 * another. `ImageFileInput` is that caller: its button *is* a label around the
 * file input, and nested labels are invalid HTML whose click forwarding has two
 * candidates to choose between (issue #807).
 */
describe("Field around a child that labels itself", () => {
  it("wraps a plain composite child, so the caption still names it", () => {
    const { container } = render(
      <Field label="Party">
        <div>
          <input name="party" className={controlClass} />
        </div>
      </Field>,
    );
    expect(container.querySelector("label")?.tagName).toBe("LABEL");
    expect(screen.getByLabelText("Party")).toHaveAttribute("name", "party");
  });

  it("stops wrapping once the caller names the control, leaving one label to nest inside", () => {
    const { container } = render(
      <Field label="Map image" htmlFor="map-image">
        <label>
          Choose a photo
          <input id="map-image" type="file" name="mapImage" className="sr-only" />
        </label>
      </Field>,
    );
    // No label with a label inside it: the caption is a sibling of the child.
    expect(container.querySelector("label label")).toBeNull();
    // And it still names the control — both labels do, caption first.
    expect(screen.getByLabelText(/Map image/)).toHaveAttribute("name", "mapImage");
  });
});

describe("FormStatus", () => {
  it("renders nothing at rest, so an action row keeps its layout", () => {
    const { container } = render(
      <FieldActions>
        <button type="submit">Save</button>
        <FormStatus tone="danger">{undefined}</FormStatus>
      </FieldActions>,
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  /**
   * **Two empty children are still empty.**
   *
   * The guard was `if (!children)`, which held only while every caller passed
   * exactly one expression. `{undefined}` is falsy; `{undefined}{null}` is an
   * *array*, and an array is truthy — so the waiver editor, which appended a
   * conditional link beside its banner, rendered a bare ✅ with no message on a
   * page at rest, and no test noticed (issue #790).
   */
  it("still renders nothing when a caller passes several empty children", () => {
    const { container } = render(
      <FieldActions>
        <button type="submit">Save</button>
        <FormStatus tone="success">
          {undefined}
          {null}
          {false}
        </FormStatus>
      </FieldActions>,
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("renders when one of several children has something to say", () => {
    render(
      <FormStatus tone="success">
        {undefined}
        {"Saved."}
      </FormStatus>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });

  it("gives a refusal role=alert so it interrupts", () => {
    render(<FormStatus tone="danger">That code is already in use.</FormStatus>);
    expect(screen.getByRole("alert")).toHaveTextContent("That code is already in use.");
  });

  it("gives a confirmation role=status so it does not", () => {
    render(<FormStatus tone="success">Saved.</FormStatus>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps its tone glyph out of the announced text", () => {
    render(<FormStatus tone="warning">Saved, and two divers no longer qualify.</FormStatus>);
    // `❌`/`⚠️` are the colourblind-safe cue, not words — a screen reader that
    // reads them aloud is reading punctuation at someone.
    const status = screen.getByRole("status");
    expect(status.querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(status.textContent).not.toContain("⚠️");
    expect(status.textContent).not.toContain("❌");
  });

  /**
   * **The mark centres on the first line, never on the baseline.** Under
   * `items-baseline` the glyph's synthesised baseline is its own bottom edge,
   * so it sat on the text's baseline and rode 2px above the caps: ink 806–819
   * against caps 810–820 on `trip-guests-refusal-card` at 1280 (K-47). A
   * one-line box around the mark, centred, puts it on the line's middle
   * whatever the message wraps to.
   */
  it("centres its mark on the message's first line", () => {
    render(<FormStatus tone="danger">That code is already in use.</FormStatus>);
    const status = screen.getByRole("alert");
    expect(status).not.toHaveClass("items-baseline");
    expect(status).toHaveClass("items-start");
    const box = status.querySelector("svg")?.parentElement;
    expect(box).not.toBe(status);
    expect(box).toHaveClass("h-lh", "items-center", "shrink-0");
  });

  it("sits inside the form it belongs to", () => {
    // The whole point: the message is a descendant of the `<form>`, not a
    // sibling of the page header. This is the assertion the e2e specs mirror.
    const { container } = render(
      <FieldGrid as="form" columns={2}>
        <Field label="Name">
          <input name="name" className={controlClass} />
        </Field>
        <FieldActions>
          <button type="submit">Save</button>
          <FormStatus tone="danger">Give the site a name.</FormStatus>
        </FieldActions>
      </FieldGrid>,
    );
    const form = container.querySelector("form");
    expect(form?.contains(screen.getByRole("alert"))).toBe(true);
  });
});

describe("StickyFormActions", () => {
  it("rides the bottom edge, which nothing stands on any more", () => {
    const { container } = render(
      <StickyFormActions>
        <button type="submit">Save</button>
      </StickyFormActions>,
    );

    expect(container.firstElementChild).toHaveClass("sticky");
    // It sat at `--dock-clearance` while the staff shell had a phone dock
    // under it (ADR 20260919-one-idea, slice 23b retired both).
    expect(container.firstElementChild).toHaveClass("bottom-0");
  });

  /**
   * **Its rule meets an edge the form has.** Both callers sit in a `<main>`
   * padded `px-4 sm:px-6`, and from `lg` in the editor rail grid's form cell,
   * which has no padding at all. Bleeding `sm:-mx-5` ran the rule and fill
   * 408–1147 at 1280 against a column of 428–1127, 20px into the rail's
   * gutter, and stopped 4px short of both screen edges from 640 to 1023
   * (K-61). Full-bleed under `lg`, exactly the column from `lg` up.
   */
  it("bleeds to main's padding below lg and runs with the form column from lg", () => {
    const { container } = render(
      <StickyFormActions>
        <button type="submit">Save</button>
      </StickyFormActions>,
    );
    const bar = container.firstElementChild;
    expect(bar).toHaveClass("-mx-4", "px-4", "sm:-mx-6", "sm:px-6", "lg:mx-0", "lg:px-0");
    expect(bar).not.toHaveClass("sm:-mx-5");
    expect(bar).not.toHaveClass("sm:px-5");
  });

  /**
   * **A field Tab lands on, or a fragment a link jumps to, lands above the
   * bar.** The bar is 73px and 95% opaque, and nothing inset the scrollport
   * for it, so a field scrolled to the bottom edge sat under it whole: "Name *"
   * and its box at 757–817 under a bar at 771–845 (dive-site-far-station at
   * 390, K-01). The bar marks itself, and the stylesheet pads the viewport's
   * bottom by the bar's height only on a page that has one — the same `:has()`
   * shape as the chrome bar's top padding.
   */
  it("marks itself so the page's scrollport keeps focus clear of it", () => {
    const { container } = render(
      <StickyFormActions>
        <button type="submit">Save</button>
      </StickyFormActions>,
    );
    expect(container.firstElementChild).toHaveAttribute("data-sticky-actions");

    const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const rule = css.match(/html:has\(\[data-sticky-actions\]\)\s*\{([^}]*)\}/);
    expect(rule, "html:has([data-sticky-actions]) { … }").not.toBeNull();
    // The bar's measured height, and until it is measured (the server's
    // paint, a browser with no ResizeObserver) its one-row height: the md
    // button (3rem), the bar's py-3 (1.5rem) and its hairline.
    expect(rule?.[1]).toMatch(
      /scroll-padding-bottom:\s*var\(--sticky-actions-h,\s*calc\(3rem \+ 1\.5rem \+ 1px\)\)/,
    );
  });

  /**
   * **The inset is the bar's real height, not its one-row height.** Both
   * callers put Save and an unsaved-changes sentence in the bar's wrapping
   * row, and at 390 the sentence wraps under Save whenever the form is dirty —
   * exactly while someone is tabbing through it — so the bar stands about
   * 105px, and a fixed 73px inset left a focused field about 32px under it
   * (K-01, review). The bar measures itself and tells the page.
   */
  it("insets the page by the bar's measured height, and follows it when its row wraps", () => {
    const fire: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          fire.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    let height = 73;
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return { height: this.hasAttribute("data-sticky-actions") ? height : 0 } as DOMRect;
      });
    const root = document.documentElement;
    try {
      const { container, unmount } = render(
        <StickyFormActions>
          <button type="submit">Save</button>
        </StickyFormActions>,
      );
      expect(root.style.getPropertyValue("--sticky-actions-h")).toBe("73px");

      height = 105;
      act(() => {
        for (const callback of fire) callback();
      });
      expect(root.style.getPropertyValue("--sticky-actions-h")).toBe("105px");

      // The measuring leaf is not a flex item: an empty span in the bar's
      // gap-3 row would push Save 12px off its edge.
      expect(container.querySelector("[data-sticky-actions] > span")).toHaveAttribute("hidden");

      unmount();
      expect(root.style.getPropertyValue("--sticky-actions-h")).toBe("");
    } finally {
      rect.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

/**
 * **A caption never leaves its last word alone.** The fly-safe label wrapped
 * to "diving *" on a line of its own, 49px of a 329px column at 1280 and the
 * same at 390 (K-586). `text-pretty` balances the last lines, and it sits on
 * the caption row of every branch, because which branch a `Field` takes is its
 * child's business, not the caption's.
 */
describe("Field's caption wraps prettily", () => {
  it("on the control branch", () => {
    render(
      <Field label="Hours between repetitive dives">
        <input name="hours" required />
      </Field>,
    );
    expect(screen.getByText("Hours between repetitive dives").parentElement).toHaveClass(
      "text-pretty",
    );
  });

  it("on the htmlFor branch", () => {
    render(
      <Field label="Map image" htmlFor="map-image">
        <label>
          Choose a photo
          <input id="map-image" type="file" name="mapImage" className="sr-only" />
        </label>
      </Field>,
    );
    expect(screen.getByText("Map image").parentElement).toHaveClass("text-pretty");
  });

  it("on the wrapping branch", () => {
    render(
      <Field label="Party">
        <div>
          <input name="party" />
        </div>
      </Field>,
    );
    expect(screen.getByText("Party")).toHaveClass("text-pretty");
  });
});

/**
 * `Field` derives the visible `*` from the control's own `required`, so a form
 * gets the marker for free and nobody has to remember it. `markRequired={false}`
 * is the one deliberate way out, for a form where every field is required and
 * the marker therefore distinguishes nothing.
 */
describe("Field's required marker", () => {
  it("marks a required control, since that is what tells it from an optional one", () => {
    render(
      <Field label="Subhead">
        <input name="subhead" required />
      </Field>,
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("marks a required forgiving box the same way, and labels it by id", () => {
    // A `ForgivingInput` is a component, not a native tag, and the fallback
    // branch it used to land in has no marker at all: the diver record's
    // "Full name" lost its `*` when the box became forgiving.
    render(
      <Field label="Full name">
        <ForgivingInput kind="name" name="fullName" required locale="en-US" copy={COPY} />
      </Field>,
    );
    expect(screen.getByText("*")).toBeInTheDocument();
    const box = screen.getByLabelText("Full name");
    expect(box).toBeRequired();
    expect(box).toHaveAttribute("id");
    expect(box).not.toHaveAttribute("name");
  });

  it("leaves an optional control unmarked", () => {
    render(
      <Field label="Subhead">
        <input name="subhead" />
      </Field>,
    );
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("can be opted out of, for a form whose every field is required", () => {
    // The buddy panel's "Add to this team": one field, one submit button, and
    // two or three open teams put two or three red marks into a panel whose
    // only meaningful warning colour is the dissolve control.
    render(
      <Field label="Add to this team" markRequired={false}>
        <select name="member" required />
      </Field>,
    );
    expect(screen.queryByText("*")).not.toBeInTheDocument();
  });

  it("opting out never relaxes the control itself — the server refusal is real", () => {
    render(
      <Field label="Add to this team" markRequired={false}>
        <select name="member" required data-testid="member" />
      </Field>,
    );
    expect(screen.getByTestId("member")).toBeRequired();
  });
});

/**
 * **`hint` is a short qualifier, and the type cannot say so.**
 *
 * It takes a `ReactNode` and renders whatever it is given, so a sentence and
 * "(optional)" are the same thing to the compiler — and the two props read as
 * interchangeable from a call site. `/onboard` passed a **31-word** sentence as
 * `hint`, which pushed the caption row to five lines, left a ~100px hole beside
 * it in the two-column grid, floated the required `*` at the end of a
 * paragraph, and — because `hint` renders *inside* the `<label>* — folded all
 * thirty-one words into the control's accessible name, so a screen reader read
 * them out every time the field was announced (issue #784).
 *
 * Nothing failed. The layout hole only appears at one breakpoint with that
 * particular string length, and `/onboard` had no capture.
 *
 * So the ceiling is stated here instead. The bound is deliberately generous —
 * it is not a style rule about brevity, it is the line past which `hint` is
 * the wrong prop and `description` is the right one, which is a question of
 * *where the text renders*, not of taste.
 */
const HINT_WORD_CEILING = 15;

/** Every `hint={t("…")}` in the app, with the words it resolves to. */
function hintsWithText(): { file: string; key: string; words: number; text: string }[] {
  const messages = new Map<string, string>();
  const flatten = (node: unknown, path: string) => {
    if (typeof node === "string") messages.set(path, node);
    else if (node && typeof node === "object")
      for (const [key, value] of Object.entries(node))
        flatten(value, path ? `${path}.${key}` : key);
  };
  // Both vocabularies, keyed the way a translator call spells them. `diver.json`
  // is namespaced by its own top-level keys; a staff bundle is one file per
  // area and the **filename** is the namespace (`staff/boats.json` →
  // `boats.…`), which is the composition `staff/index.ts` performs.
  const localeRoot = path.join(process.cwd(), "src/i18n/locales/en-US");
  flatten(JSON.parse(readFileSync(path.join(localeRoot, "diver.json"), "utf8")), "");
  const staffRoot = path.join(localeRoot, "staff");
  for (const entry of readdirSync(staffRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    flatten(
      JSON.parse(readFileSync(path.join(staffRoot, entry.name), "utf8")),
      entry.name.replace(/\.json$/, ""),
    );
  }

  const found: { file: string; key: string; words: number; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
        const source = readFileSync(full, "utf8");
        for (const match of source.matchAll(/\bhint=\{t\(\s*"([^"]+)"/g)) {
          const key = match[1];
          if (!key) continue;
          const text = messages.get(key);
          // A key this scan cannot resolve is not a finding: staff bundles are
          // composed under their own namespace and a few hints are computed.
          if (!text) continue;
          found.push({
            file: path.relative(process.cwd(), full),
            key,
            words: text.trim().split(/\s+/).length,
            text,
          });
        }
      }
    }
  };
  for (const root of ["src/app", "src/components"]) walk(path.join(process.cwd(), root));
  return found;
}

describe("Field's hint stays a qualifier", () => {
  it("finds enough hints to be worth asserting on", () => {
    // A scan that silently resolves nothing would pass forever.
    expect(hintsWithText().length).toBeGreaterThan(20);
  });

  it("refuses a hint long enough to belong in `description`", () => {
    const overlong = hintsWithText()
      .filter((hint) => hint.words > HINT_WORD_CEILING)
      // Named, not counted: the fix is per call site and needs the key.
      .map(
        (hint) => `${hint.file} — ${hint.key} (${hint.words} words): ${hint.text.slice(0, 60)}…`,
      );
    expect(overlong).toEqual([]);
  });
});

/**
 * Issue #1022. Under `cacheComponents`, a client-side navigation resumes a
 * prerendered shell beside streamed dynamic content — two render passes, each
 * starting React's server `useId` counter at 1 — so two `Field`s can be handed
 * the same generated id and `<label for>` then names the wrong control. Folding
 * the control's own `name` into the id separates every pair those two counters
 * can produce.
 *
 * jsdom renders one pass, so it cannot stage the collision itself; what it can
 * pin is the property the fix rests on — that the id carries the name, and that
 * the whole `label`/`aria-describedby` triple still points at the control.
 */
describe("Field id scoping", () => {
  it("folds the control's name into the generated id", () => {
    render(
      <Field label="Maximum depth" description="Metres.">
        <input name="maxDepthMeters" className={controlClass} />
      </Field>,
    );
    const input = screen.getByLabelText("Maximum depth");
    expect(input.id).toMatch(/-maxDepthMeters$/);
    // The description travels with it, so nothing is left pointing at the
    // unscoped id.
    expect(input.getAttribute("aria-describedby")).toBe(`${input.id}-description`);
  });

  it("gives two same-named controls ids that differ anyway", () => {
    render(
      <>
        <Field label="First note">
          <input name="note" className={controlClass} />
        </Field>
        <Field label="Second note">
          <input name="note" className={controlClass} />
        </Field>
      </>,
    );
    expect(screen.getByLabelText("First note").id).not.toBe(
      screen.getByLabelText("Second note").id,
    );
  });

  // A name may legally hold characters an id may not.
  it("does not put whitespace or brackets from a name into an id", () => {
    render(
      <Field label="Diver note">
        <input name="party[0].note text" className={controlClass} />
      </Field>,
    );
    const input = screen.getByLabelText("Diver note");
    expect(input.id).toMatch(/^[A-Za-z0-9_\-«»:]+$/);
    expect(input.id).toContain("party_0__note_text");
  });

  it("leaves a caller-supplied id alone", () => {
    render(
      <Field label="Name" htmlFor="chosen-by-the-caller">
        <input id="chosen-by-the-caller" name="name" className={controlClass} />
      </Field>,
    );
    expect(screen.getByLabelText("Name").id).toBe("chosen-by-the-caller");
  });
});

/**
 * **Source sweeps: a call site stays on the primitive.** A shared piece fixes
 * a defect once only while nothing spells around it, so each rule below reads
 * every `.tsx` under `src/` (tests aside, comments stripped, so a doc comment
 * quoting the old spelling is not a finding) and names the file and line of
 * anything that does.
 */
type SourceFile = { file: string; source: string };

function sourceFiles(): SourceFile[] {
  const found: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
        const source = readFileSync(full, "utf8")
          // Block and JSX comments, kept as blank lines so line numbers hold.
          .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
          // Whole-line `//` comments only: a `//` mid-line may be a URL.
          .replace(/^[ \t]*\/\/.*$/gm, "");
        found.push({ file: path.relative(process.cwd(), full), source });
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
  return found;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/**
 * Every opening `<tag …>` of one JSX element name, whole: read up to the `>`
 * that closes it, stepping over `{…}` expressions (an arrow's `=>` is not the
 * end of a tag) and quoted attribute values.
 */
function openingTags(source: string, tag: string): { index: number; text: string }[] {
  const tags: { index: number; text: string }[] = [];
  const start = new RegExp(`<${tag}(?![A-Za-z0-9_])`, "g");
  for (const match of source.matchAll(start)) {
    let depth = 0;
    let quote: string | null = null;
    let end = match.index + match[0].length;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) {
        if (char === quote) quote = null;
      } else if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (depth === 0 && (char === '"' || char === "'")) quote = char;
      else if (depth === 0 && char === ">") break;
    }
    tags.push({ index: match.index, text: source.slice(match.index, end + 1) });
  }
  return tags;
}

describe("source sweeps", () => {
  it("reads enough of the app to be worth asserting on", () => {
    expect(sourceFiles().length).toBeGreaterThan(300);
  });

  /**
   * **A control keeps its 16px type.** An appended `text-sm`/`text-xs` wins
   * over `controlClass`'s `text-base` by stylesheet order, so one field drew
   * at three sizes on one page — "Assign crew…" at a 10px cap beside "Every
   * week" at 12px (trip-repeating-cadence, trip-crew-clash; K-45) — and iOS
   * Safari zooms the page when a box under 16px takes focus. A denser control
   * is a `controlClassFor` size that keeps 16px, never an appended size. The
   * one exception is the embed page's read-only code snippet, which is a
   * block of code to copy, not a box anyone types in.
   */
  it("never appends a smaller type size to a control's class", () => {
    const allowed = new Set(["src/app/shop/[shopSlug]/settings/embed/SnippetField.tsx"]);
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      if (allowed.has(file)) continue;
      const templates =
        /`[^`]*\$\{(?:controlClass(?:For\([^)]*\))?|textareaClassFor\([^)]*\))\}[^`]*`/g;
      for (const match of source.matchAll(templates)) {
        if (/\btext-(xs|sm)\b/.test(match[0]))
          offenders.push(`${file}:${lineOf(source, match.index)} ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * **One gutter between a form's columns.** `FieldGrid` draws 16px, and call
   * sites appended `gap-x-5 gap-y-5`, which won by stylesheet order: on one
   * settings page the dock-day and fly-safe columns stood 20px apart and the
   * emergency and rental-price columns 16px (K-42). A form that ever wants a
   * different gutter gets it as a prop on `FieldGrid`, not as a class.
   */
  /**
   * **A bordered fieldset's legend starts on its fields' edge.** `px-1` pads
   * the notch the legend cuts in the border, and on its own it also moved the
   * words 4px right of every field under them (orders-new: legend text at 326,
   * fields at 322; K-289). `legendClass` is the notch with the words pulled
   * back, and nothing spells the padding by hand.
   */
  it("keeps a legend's notch padding in legendClass", () => {
    expect(legendClass).toBe("-ms-1 px-1");
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      for (const { index, text } of openingTags(source, "legend")) {
        if (/\bpx-1\b/.test(text)) offenders.push(`${file}:${lineOf(source, index)} ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * **A checkbox or radio a person sees is drawn one way.** Every visible box
   * wears `choiceClass` — directly, or through `ChoiceRow` / `ChoicePill`,
   * which are the only other places a box is spelled. K-13 found the platform's
   * 13px radios beside 16px checkboxes, `size-4` boxes without `shrink-0` that
   * squash beside a label long enough to wrap, and the forms plugin's classes
   * this app does not load (`rounded border-border text-primary
   * focus:ring-*`, which do nothing to a native box). A first sweep refused
   * only the unsized and the plugin-classed, and 43 of 52 visible boxes still
   * spelled `size-4` by hand, most without `shrink-0` (K-13 review). A box
   * that is `sr-only` or `opacity-0` is a stand-in's business, not this rule's.
   *
   * Two boxes are 20px on purpose and named here by path: the conditions
   * hold, a warning-tinted card whose box stands beside its 16px semibold
   * heading, and the buddy builder's drag rows, a manifest surface whose own
   * note asks for a box big enough to hit without aiming.
   */
  it("draws every visible choice box with choiceClass", () => {
    const deliberate20px = new Set([
      "src/app/shop/[shopSlug]/trips/[id]/_components/ConditionsSection.tsx",
      "src/app/shop/[shopSlug]/trips/[id]/manifest/_components/BuddyDragGroups.tsx",
    ]);
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      for (const { index, text } of openingTags(source, "input")) {
        if (!/type=(?:"|\{")(checkbox|radio)"/.test(text)) continue;
        if (/\b(sr-only|opacity-0)\b/.test(text)) continue;
        const where = `${file}:${lineOf(source, index)}`;
        if (!/\bchoiceClass\b/.test(text) && !deliberate20px.has(file))
          offenders.push(`${where} lacks choiceClass`);
        if (/\b(rounded|border-[a-z-]+|text-primary|focus:ring-[a-z-]+)\b/.test(text))
          offenders.push(`${where} wears forms-plugin classes`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // A pill is a 44px bordered row padded at its sides. A bordered *card*
  // padded all round (`p-3`), holding a title and a sentence — the merge
  // picker, the conditions hold — is another component and not this rule's.
  // The pill with something beside its words is a bordered `<div>` around its
  // label, so the rule reads those too: a hand-spelled one stood its box 4px
  // off the plain pill's beside it (RentalFitForm, K-13 review).
  it("draws every bordered answer pill with ChoicePill", () => {
    const offenders: string[] = [];
    const bordered = (text: string) =>
      ["rounded-lg", "border", "min-h-11"].every((token) =>
        new RegExp(`\\b${token}\\b`).test(text),
      );
    const holdsABox = (body: string) =>
      /type=(?:"|\{")(checkbox|radio)"/.test(body) && !/\bsr-only\b/.test(body);
    for (const { file, source } of sourceFiles()) {
      for (const { index, text } of openingTags(source, "label")) {
        if (!bordered(text) || !/\bpx-\d/.test(text)) continue;
        const body = source.slice(index + text.length, source.indexOf("</label>", index));
        if (holdsABox(body)) offenders.push(`${file}:${lineOf(source, index)}`);
      }
      for (const { index, text } of openingTags(source, "div")) {
        if (!bordered(text)) continue;
        const body = source.slice(index + text.length, source.indexOf("</div>", index));
        if (/<label\b/.test(body) && holdsABox(body))
          offenders.push(`${file}:${lineOf(source, index)} (a bordered div around a label)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A legend's gap to its choices belongs to `ChoiceFieldset` (K-72): a
   * legend with its own bottom margin is a caption drawn another way. A
   * floated legend is exempt — a float is how a legend escapes the rendered
   * legend's place in a bordered box, and the clearing sibling after it
   * cannot take a top margin (clearance absorbs it), so its margin is the
   * only one there is.
   */
  it("leaves the caption gap to ChoiceFieldset, never a legend's own margin", () => {
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      for (const { index, text } of openingTags(source, "legend")) {
        if (/\bfloat-/.test(text)) continue;
        if (/\bmb-/.test(text)) offenders.push(`${file}:${lineOf(source, index)} ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A legend spelled as `ChoiceFieldset`'s caption (`text-sm font-medium`) is
   * a group caption drawn by hand, and the ones found sat 8px or 12px above
   * their choices where a field caption sits 4px: the rental "What to plan"
   * and nitrox groups (`mt-2`, and a pill written `mt-2` under its legend),
   * the staff rental toggles, the ready page's re-entry answers, the booking
   * form's gift choice and a departure's required specialties (`mt-3`), each
   * touched by the batch that moved its boxes (K-72 review). The rule's own
   * wording is that the rest follow as they are touched: the three below have
   * not been, and a file leaves this list the day it is. A bordered
   * fieldset's legend (`legendClass`, the notch in its border) is another
   * shape and not this rule's.
   */
  it("captions a group of choices with ChoiceFieldset, not a hand-spelled legend", () => {
    const notYetTouched = new Set([
      "src/app/shop/[shopSlug]/orders/new/page.tsx",
      "src/components/StarRatingInput.tsx",
      "src/components/RepeatFields.tsx",
    ]);
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      if (file === "src/components/ui/form.tsx" || notYetTouched.has(file)) continue;
      for (const { index, text } of openingTags(source, "legend")) {
        if (/\b(sr-only|legendClass)\b/.test(text)) continue;
        if (/\btext-sm\b/.test(text) && /\bfont-medium\b/.test(text))
          offenders.push(`${file}:${lineOf(source, index)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A temporal box is a `DateField` (K-54): spelled bare, it wears the
   * platform's indicator and, on iOS, nothing at all when empty.
   */
  it("enters a month, a time or a date-and-time through DateField, never a bare input", () => {
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      if (file === "src/components/ui/form.tsx") continue;
      for (const { index, text } of openingTags(source, "input")) {
        if (/type="(date|month|time|datetime-local|week)"/.test(text))
          offenders.push(`${file}:${lineOf(source, index)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * A textarea on the bare control class stops growing with its text (K-46),
   * and one whose minimum disagrees with its `rows` draws two sizes: the
   * minimum where `field-sizing` works and `rows` where it does not.
   */
  it("draws every textarea with textareaClassFor, at its own rows", () => {
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      if (file === "src/components/ui/form.tsx") continue;
      for (const { index, text } of openingTags(source, "textarea")) {
        const where = `${file}:${lineOf(source, index)}`;
        if (/\bcontrolClass(For)?\b/.test(text)) offenders.push(`${where} on controlClass`);
        const min = text.match(/textareaClassFor\(([^)]*)\)/)?.[1]?.trim();
        const rows = text.match(/\brows=\{([^}]+)\}/)?.[1]?.trim();
        if (min !== undefined && min !== rows)
          offenders.push(`${where} rows={${rows}} but textareaClassFor(${min})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never overrides FieldGrid's column gutter at a call site", () => {
    const offenders: string[] = [];
    for (const { file, source } of sourceFiles()) {
      for (const { index, text } of openingTags(source, "FieldGrid")) {
        if (/\bgap-x-/.test(text)) offenders.push(`${file}:${lineOf(source, index)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
