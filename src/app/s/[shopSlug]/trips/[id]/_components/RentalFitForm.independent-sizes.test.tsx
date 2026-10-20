// @vitest-environment jsdom
import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DiverRentalFit } from "@/db/rental-fit";
import { EMPTY_RENTAL_PRICING, NOTHING_RENTED } from "@/lib/rentals";
import { renderDiver } from "@/test/intl";
import { RentalFitForm } from "./RentalFitForm";

afterEach(cleanup);

it("posts an unchanged boot and fin fit as separate answers", () => {
  const fit: DiverRentalFit = {
    ...NOTHING_RENTED,
    rentsWetsuit: true,
    rentsFins: true,
    bcdSize: null,
    wetsuitSize: "M",
    drysuitSize: null,
    hoodSize: null,
    gloveSize: null,
    bootSize: "EU 39",
    finSize: "XL",
    weightPreference: null,
    divesDry: false,
    note: null,
    fitStatedAt: new Date("2026-10-19T12:00:00Z"),
  };
  const { container } = renderDiver(
    <RentalFitForm
      action={vi.fn()}
      rentalFit={fit}
      rentalItems={["wetsuit", "mask", "fins"]}
      course={null}
      pricing={EMPTY_RENTAL_PRICING}
      wantsNitrox={false}
      nitroxCardVerified={false}
      plannedDives={2}
      saved={false}
      currency="usd"
    />,
  );
  expect(screen.getByLabelText(/Fin size/)).toHaveValue("XL");
  expect(screen.getByLabelText(/Boot size/)).toHaveValue("EU 39");
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  const post = new FormData(form ?? undefined);
  expect(post.get("finSize")).toBe("XL");
  expect(post.get("bootSize")).toBe("EU 39");
  expect(post.get("fins")).toBe("on");
  expect(post.get("mask")).toBeNull();
});
