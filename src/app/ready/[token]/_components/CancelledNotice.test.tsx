// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { cancelledNotice } from "./CancelledNotice";

const t = diverTranslator("en-US");

afterEach(cleanup);

describe("cancelledNotice", () => {
  it("says the seat was released when nothing was paid", () => {
    render(cancelledNotice(null, "Two-Tank Reef", "Blue Mantis Divers", t));
    expect(screen.getByText(t("ready.cancelledHeading"))).toBeTruthy();
    expect(
      screen.getByText(
        t("ready.cancelledSeatReleased", { trip: "Two-Tank Reef", shop: "Blue Mantis Divers" }),
      ),
    ).toBeTruthy();
  });

  it("reads its refund line from the payment row's status", () => {
    const { container } = render(cancelledNotice("refunded", "Two-Tank Reef", "Shop", t));
    expect(container.textContent).not.toContain(
      t("ready.cancelledSeatReleased", { trip: "Two-Tank Reef", shop: "Shop" }),
    );
  });
});
