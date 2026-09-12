// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The control statically imports the home's `"use server"` actions file, whose
// own imports reach better-auth and the database — the same reason the spine's
// tests mock it. `bind` is the mock's own, so the arguments the tap carries to
// the server are readable here.
const bindKeepRentalFit = vi.hoisted(() =>
  vi.fn((_thisArg: unknown, _reservationId: string) => () => {}),
);
vi.mock("@/app/shop/[shopSlug]/actions", () => ({
  keepRentalFitAction: Object.assign(() => {}, { bind: bindKeepRentalFit }),
}));

import { RentalFitKeepControl } from "./RentalFitKeepControl";

afterEach(() => {
  cleanup();
  bindKeepRentalFit.mockClear();
});

describe("RentalFitKeepControl", () => {
  it("is a form that submits, never a link to somewhere else", () => {
    const { container } = render(
      <RentalFitKeepControl reservationId="r1" label="Keep it" pendingLabel="Keeping" />,
    );

    // The size is already known, so this row's fix is the tap itself.
    expect(container.querySelector("form")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveAttribute("type", "submit");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("takes every word as a prop, pending label included", () => {
    // Staff copy is resolved server-side and never crosses to the client
    // (`src/i18n/staff-messages.ts`), so a missing word is a missing prop
    // rather than a bundle lookup inside a Client Component.
    render(<RentalFitKeepControl reservationId="r1" label="Guardarla" pendingLabel="Guardando" />);

    expect(screen.getByRole("button", { name: "Guardarla" })).toBeInTheDocument();
  });

  it("binds the reservation and nothing else", () => {
    // The diver and the size are not the client's to supply. A bound size is a
    // size any staff role could post against any diver in the shop, which is
    // the act `canOverrideGearRequest` reserves for owner, manager, instructor
    // and divemaster (`security-reviewer`, issue #1453). The action re-proves
    // all three from the desk's own `fit_adjusted` return instead.
    render(<RentalFitKeepControl reservationId="r1" label="Keep it" pendingLabel="Keeping" />);

    expect(bindKeepRentalFit).toHaveBeenCalledWith(null, "r1");
  });
});
