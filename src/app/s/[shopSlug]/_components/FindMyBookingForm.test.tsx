// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { FindMyBookingForm } from "./FindMyBookingForm";

vi.mock("../actions", () => ({ requestFindMyBookingAction: vi.fn() }));

afterEach(cleanup);

/**
 * **The email box stands level with "Send my link".** The box was the stacked
 * field's 44px beside the `md` submit's 48px, and the row is `items-end`, so
 * the button stood 4px above the box's top edge. The box inside a `Field` is
 * grouped with its caption, so the pixel probe's row checks never compared
 * the two; this was found by reading the code (review of 2026-09-25).
 *
 * jsdom lays nothing out, so this pins which element carries which size, not
 * the pixels. The row sits inside a shut disclosure, hence `hidden: true`.
 */
describe("FindMyBookingForm", () => {
  it("gives the email box the md height of the submit beside it", () => {
    render(
      <DiverIntlProvider
        locale="en-US"
        timeZone="America/New_York"
        namespaces={["common", "findMyBooking"]}
      >
        <FindMyBookingForm shopSlug="blue-mantis" />
      </DiverIntlProvider>,
    );
    const box = screen.getByRole("textbox", { name: "Email", hidden: true });
    const submit = screen.getByRole("button", { name: "Send my link", hidden: true });
    expect(submit).toHaveClass("min-h-12", "text-base");
    expect(box).toHaveClass("min-h-12", "text-base");
    expect(box).not.toHaveClass("min-h-11");
  });
});
