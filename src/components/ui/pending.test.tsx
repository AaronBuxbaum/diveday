// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ShopStat } from "@/components/ShopPageHeader";
import { BUTTON_RADIUS, buttonClass } from "./button";
import { BONE_SHAPE, Bone, Pending } from "./pending";

afterEach(cleanup);

describe("Bone", () => {
  it("is a line of words by default: the caller's geometry, a line's corner, the sunken fill", () => {
    const bar = render(<Bone className="h-4 w-32" />).container.firstElementChild;
    expect(bar?.tagName).toBe("DIV");
    expect(bar?.className).toBe("h-4 w-32 rounded bg-surface-sunken");
  });

  it("takes a control's corner from the button's own class string, not from the call site", () => {
    // If the control rung's corner moves, every bar standing in for a button
    // moves with it: the skeleton cannot keep the old corner.
    expect(BONE_SHAPE.control).toBe(BUTTON_RADIUS.rounded);
    expect(buttonClass().split(" ")).toContain(BUTTON_RADIUS.rounded);
    expect(BONE_SHAPE.pill).toBe(BUTTON_RADIUS.pill);
    const bar = render(<Bone shape="control" className="h-12 w-44" />).container.firstElementChild;
    expect(bar).toHaveClass("h-12", "w-44", BUTTON_RADIUS.rounded, "bg-surface-sunken");
  });

  it("renders the element a phrasing or list parent needs, passing its attributes through", () => {
    const { container } = render(
      <ul>
        <Bone as="li" shape="inset" data-row className="h-12" />
      </ul>,
    );
    const row = container.querySelector("li");
    expect(row).toHaveAttribute("data-row");
    expect(row).toHaveClass("h-12", "rounded-inset", "bg-surface-sunken");
  });

  it("draws a bleed image with no corner at all", () => {
    const bar = render(<Bone shape="bleed" className="h-44 w-full" />).container.firstElementChild;
    expect(bar?.className).toBe("h-44 w-full bg-surface-sunken");
  });
});

describe("Pending", () => {
  it("is the one pulse, on the element it replaces", () => {
    const main = render(
      <Pending as="main" className="flex-1">
        <Bone className="h-4" />
      </Pending>,
    ).container.firstElementChild;
    expect(main?.tagName).toBe("MAIN");
    expect(main?.className).toBe("animate-pulse flex-1");
  });

  it("can pulse a page component's own <main>, so the screenshot guard's `main.animate-pulse` sees it", () => {
    // The shape `<Pending as={StaffPage} width="full">` takes: a component that
    // renders the `<main>` and merges the `className` it is handed.
    function Page({
      width,
      className = "",
      children,
    }: {
      width: string;
      className?: string;
      children?: React.ReactNode;
    }) {
      return <main className={`${width} ${className}`}>{children}</main>;
    }
    const main = render(
      <Pending as={Page} width="max-w-6xl">
        <Bone className="h-4" />
      </Pending>,
    ).container.firstElementChild;
    expect(main?.tagName).toBe("MAIN");
    expect(main).toHaveClass("animate-pulse", "max-w-6xl");
  });
});

describe("ShopStat pending", () => {
  it("is the raised tile's own box, holding one bar per row at the row's own type size", () => {
    const resting = render(<ShopStat label="Tanks" value={12} />).container.firstElementChild;
    const restingClass = resting?.className;
    cleanup();
    const tile = render(<ShopStat pending />).container.firstElementChild;
    expect(tile?.className).toBe(restingClass);
    const [label, figure] = Array.from(tile?.children ?? []);
    expect(label).toHaveClass("h-lh", "text-sm", "bg-surface-sunken");
    expect(figure).toHaveClass("h-lh", "text-3xl", "bg-surface-sunken");
  });
});
