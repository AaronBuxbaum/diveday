// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The control statically imports the home's `"use server"` actions file, whose
// own imports reach better-auth and the database — the same reason the spine's
// tests mock it.
vi.mock("@/app/shop/[shopSlug]/actions", () => ({ keepRentalFitAction: vi.fn() }));

import { RentalFitKeepControl } from "./RentalFitKeepControl";

afterEach(() => {
  cleanup();
});

describe("RentalFitKeepControl", () => {
  it("is a form that submits, never a link to somewhere else", () => {
    const { container } = render(
      <RentalFitKeepControl
        personId="p1"
        kind="bcd"
        size="L"
        label="Keep it"
        pendingLabel="Keeping"
      />,
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
    render(
      <RentalFitKeepControl
        personId="p1"
        kind="wetsuit"
        size="3mm L"
        label="Guardarla"
        pendingLabel="Guardando"
      />,
    );

    expect(screen.getByRole("button", { name: "Guardarla" })).toBeInTheDocument();
  });
});
