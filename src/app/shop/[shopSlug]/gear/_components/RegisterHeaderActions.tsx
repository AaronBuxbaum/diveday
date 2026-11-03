import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { counterRentalFormPath } from "../rentals/rental-form";

/**
 * The register's header acts on a register with units: lend some out, and add
 * one. "Add a unit" stays the page's primary (UX audit 2026-10-07, item 31);
 * "Rent out" sits beside it at secondary weight, the door to lending to
 * somebody who is not on a boat (ADR 20260815-minimal-gear-register, amended
 * 2026-10-08), which opens the register's own panel (`?add=rental`). The empty register keeps its one door in the card instead.
 */
export function RegisterHeaderActions({
  shopSlug,
  t,
  addUnitControl,
  rentingOut = false,
}: {
  shopSlug: string;
  t: StaffTranslator;
  addUnitControl: ReactNode;
  /** The rent-out panel is already open below; its door stands down. */
  rentingOut?: boolean;
}) {
  return (
    <>
      {rentingOut ? null : (
        <Link
          href={counterRentalFormPath(shopSlug)}
          className={buttonClass({ variant: "secondary" })}
        >
          {t("counterRentals.rentOut")}
        </Link>
      )}
      {addUnitControl}
    </>
  );
}
