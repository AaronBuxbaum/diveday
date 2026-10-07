// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GuardianEmailErasure } from "./GuardianEmailErasure";

vi.mock("../actions", () => ({ eraseGuardianEmailAction: vi.fn() }));

afterEach(cleanup);

/** H-103, issue #1673: one shut danger band per guardian address, typed back to erase. */
describe("GuardianEmailErasure", () => {
  it("renders nothing when no release on this record carries a guardian's address", () => {
    const { container } = render(
      <GuardianEmailErasure emails={[]} shopSlug="blue-mantis" personId="p" locale="en-US" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers each address behind its own shut disclosure and a typed confirmation", () => {
    const { container } = render(
      <GuardianEmailErasure
        emails={["jonas@example.com", "ana@example.com"]}
        shopSlug="blue-mantis"
        personId="p"
        locale="en-US"
      />,
    );
    const bands = container.querySelectorAll("details");
    expect(bands).toHaveLength(2);
    for (const band of bands) expect(band).not.toHaveAttribute("open");
    expect(screen.getByText("Erase jonas@example.com")).toBeInTheDocument();
    const box = screen.getByPlaceholderText("ana@example.com");
    expect(box).toBeRequired();
    expect(box).toHaveAttribute("name", "confirmEmail");
    const hidden = container.querySelectorAll('input[type="hidden"][name="email"]');
    expect([...hidden].map((input) => input.getAttribute("value"))).toEqual([
      "jonas@example.com",
      "ana@example.com",
    ]);
  });

  it("opens the one band and says what happened when the outcome is its own", () => {
    const { container } = render(
      <GuardianEmailErasure
        emails={["jonas@example.com"]}
        shopSlug="blue-mantis"
        personId="p"
        locale="en-US"
        status={{ form: "guardian-email", tone: "danger", text: "Typed wrong." }}
      />,
    );
    expect(container.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByText("Typed wrong.")).toBeInTheDocument();
  });
});
