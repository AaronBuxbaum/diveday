// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LedgerGroup, LedgerRow, RowKind } from "./ledger";

afterEach(cleanup);

describe("LedgerGroup", () => {
  it("folds as a native <details> — the one disclosure spelling", () => {
    // Native, so keyboard and screen-reader behaviour come free and a JS
    // failure still leaves the rows one tap away. Every collapsing group in
    // the app is this; no slice invents a second.
    const { container, rerender } = render(
      <LedgerGroup label="This week" folded>
        <p>a row</p>
      </LedgerGroup>,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details?.querySelector("summary")).toContainElement(screen.getByText("This week"));
    // The caret is the shared drawn one, not a second chevron.
    expect(details?.querySelector("summary svg")).not.toBeNull();

    rerender(
      <LedgerGroup label="This week" folded={false}>
        <p>a row</p>
      </LedgerGroup>,
    );
    expect(container.querySelector("details")).toHaveAttribute("open");
  });
});

describe("LedgerRow", () => {
  it("makes the whole row the target when the row is a door", () => {
    render(
      <LedgerRow as="div" href="/shop/blue-mantis/divers/1" linkLabel="Open Grace Mensah">
        Grace Mensah
      </LedgerRow>,
    );
    expect(screen.getByRole("link", { name: "Open Grace Mensah" })).toHaveClass(
      "absolute",
      "inset-0",
    );
  });

  it("renders no link at all when the row is not a door", () => {
    // The silence matters: a row that carries its own fix must not also be
    // wrapped in an overlay that swallows the tap.
    render(<LedgerRow as="div">Grace Mensah</LedgerRow>);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("cannot be a door without a name for it", () => {
    // A stretched overlay link with no children and no `aria-label` is an
    // unnamed link — an axe `link-name` violation on the one control the row's
    // whole text sits behind. The guard is the type, not a runtime default:
    // `href` and `linkLabel` are one union, so this fails `pnpm typecheck`.
    render(
      // @ts-expect-error — `href` without `linkLabel` is not a valid door.
      <LedgerRow as="div" href="/shop/blue-mantis/divers/1">
        Grace Mensah
      </LedgerRow>,
    );
    // ...and the pair, together, still names the link.
    cleanup();
    render(
      <LedgerRow as="div" href="/shop/blue-mantis/divers/1" linkLabel="Open Grace Mensah">
        Grace Mensah
      </LedgerRow>,
    );
    expect(screen.getByRole("link")).toHaveAccessibleName("Open Grace Mensah");
  });
});

describe("RowKind", () => {
  it("carries a tally inside the label, and only a positive one", () => {
    const { rerender } = render(<RowKind word="Waiver" tone="neutral" count={3} />);
    expect(screen.getByText("3")).toHaveClass("tabular-nums");

    rerender(<RowKind word="Waiver" tone="neutral" count={0} />);
    // A kind that turned up cannot also be a "· 0" — it would contradict its
    // own presence.
    expect(screen.queryByText("0")).toBeNull();
  });
});
