// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiverIntlProvider } from "@/i18n/DiverIntlProvider";
import { AlreadyBookedDoor } from "./AlreadyBookedDoor";

const { requestFindMyBookingAction } = vi.hoisted(() => ({
  requestFindMyBookingAction: vi.fn(async () => ({ success: true })),
}));
vi.mock("../../../actions", () => ({ requestFindMyBookingAction }));

afterEach(cleanup);

function renderDoor() {
  return render(
    <DiverIntlProvider
      locale="en-US"
      timeZone="America/New_York"
      namespaces={["booking", "findMyBooking"]}
    >
      <AlreadyBookedDoor shopSlug="blue-mantis" email="nora@example.com" />
    </DiverIntlProvider>,
  );
}

/** UX review 2026-10-11, item 8: the already-booked refusal is a door, not a wall. */
describe("AlreadyBookedDoor", () => {
  it("offers to send the diver's link and says where a second seat comes from", () => {
    renderDoor();
    expect(screen.getByRole("button", { name: "Send me my link" })).toBeVisible();
    expect(screen.getByText(/add a seat for them there/)).toBeVisible();
  });

  it("sends through the find-my-booking action, for the address the refusal was about", async () => {
    renderDoor();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send me my link" }));
    });
    expect(requestFindMyBookingAction).toHaveBeenCalledOnce();
    const [shopSlug, , formData] = requestFindMyBookingAction.mock.calls[0] as unknown as [
      string,
      unknown,
      FormData,
    ];
    expect(shopSlug).toBe("blue-mantis");
    expect(formData.get("email")).toBe("nora@example.com");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "If that email has a current booking with us",
    );
  });
});
