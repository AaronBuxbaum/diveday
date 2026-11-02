// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { AddSeat } from "./AddSeat";

afterEach(cleanup);

/** UX review 2026-10-11, item 13: bring a friend from the diver's own page. */
describe("AddSeat", () => {
  it("asks for the friend's name and nothing else", () => {
    render(<AddSeat action={async () => {}} t={diverTranslator("en-US")} />);
    const name = screen.getByRole("textbox", { name: "Their name", hidden: true });
    expect(name).toHaveAttribute("name", "seatName");
    expect(name).toBeRequired();
    expect(screen.getAllByRole("textbox", { hidden: true })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Add a seat", hidden: true })).toBeInTheDocument();
  });
});
