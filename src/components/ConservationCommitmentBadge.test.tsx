// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import { ConservationCommitmentBadge } from "./ConservationCommitmentBadge";

describe("ConservationCommitmentBadge", () => {
  const enT = diverTranslator("en-US");
  const esT = diverTranslator("es-ES");

  it("renders Green Fins member badge with logo in English and Spanish", () => {
    const { rerender } = render(<ConservationCommitmentBadge code="green_fins_member" t={enT} />);
    expect(screen.getByText("Green Fins member")).toBeInTheDocument();

    rerender(<ConservationCommitmentBadge code="green_fins_member" t={esT} />);
    expect(screen.getByText("Miembro de Green Fins")).toBeInTheDocument();
  });

  it("renders PADI AWARE partner badge with logo in English and Spanish", () => {
    const { rerender } = render(<ConservationCommitmentBadge code="padi_aware_partner" t={enT} />);
    expect(screen.getByText("PADI AWARE partner")).toBeInTheDocument();

    rerender(<ConservationCommitmentBadge code="padi_aware_partner" t={esT} />);
    expect(screen.getByText("Socio de PADI AWARE")).toBeInTheDocument();
  });

  it("renders operational commitments with icon and label", () => {
    render(<ConservationCommitmentBadge code="no_touch_policy" t={enT} />);
    expect(screen.getByText("No-touch reef policy")).toBeInTheDocument();
  });
});
