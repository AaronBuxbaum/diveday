// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PulseFacts } from "./PulseFacts";

afterEach(cleanup);

const label = (count: number) => `${count} things before boarding`;

describe("PulseFacts (UX audit item 23)", () => {
  it("renders nothing when nothing needs anyone", () => {
    const { container } = render(<PulseFacts facts={[]} foldLabel={label} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a single work fact as its own link", () => {
    render(<PulseFacts facts={[{ text: "1 order is awaiting payment", href: "/o" }]} foldLabel={label} />);
    expect(screen.getByRole("link", { name: "1 order is awaiting payment" })).toBeVisible();
    expect(screen.queryByText(/before boarding/)).toBeNull();
  });

  it("folds two work facts into one closed line that opens to the same doors", () => {
    const { container } = render(
      <PulseFacts
        facts={[
          { text: "4 divers are missing rental sizes", href: "/prep" },
          { text: "1 order is awaiting payment", href: "/orders" },
        ]}
        foldLabel={label}
      />,
    );
    const fold = container.querySelector("details");
    expect(fold).not.toBeNull();
    expect(fold).not.toHaveAttribute("open");
    expect(screen.getByText("2 things before boarding")).toBeInTheDocument();
    expect(fold?.querySelectorAll("a")).toHaveLength(2);
  });

  it("never folds a fact that holds the boat up", () => {
    render(
      <PulseFacts
        facts={[
          { text: "Needs an instructor", href: "?view=details#crew", tone: "danger" },
          { text: "4 divers are missing rental sizes", href: "/prep" },
          { text: "1 order is awaiting payment", href: "/orders" },
        ]}
        foldLabel={label}
      />,
    );
    const hazard = screen.getByRole("link", { name: "Needs an instructor" });
    expect(hazard.closest("details")).toBeNull();
  });
});
