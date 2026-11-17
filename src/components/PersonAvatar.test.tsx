// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { initialsOf, PersonAvatar } from "./PersonAvatar";

it("takes the first and last initial", () => {
  expect(initialsOf("Dana Reyes")).toBe("DR");
  expect(initialsOf("Ana María de la Cruz")).toBe("AC");
  expect(initialsOf("Cher")).toBe("C");
  expect(initialsOf("  ")).toBe("");
});

it("draws initials when there is no photo", () => {
  render(<PersonAvatar name="Dana Reyes" />);
  expect(screen.getByText("DR")).toBeTruthy();
});

it("requests private photos directly, without the shared image optimizer", () => {
  const path = "/api/person-photos/abc/abcdefghijklmnopqrstuv.jpg";
  const { container } = render(<PersonAvatar name="Dana Reyes" photoPath={path} />);
  expect(container.querySelector("img")?.getAttribute("src")).toBe(path);
  expect(container.querySelector("img")?.getAttribute("srcset")).toBeNull();
});
