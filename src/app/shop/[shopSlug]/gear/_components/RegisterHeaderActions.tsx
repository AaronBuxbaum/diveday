import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";
import { AddUnitLink } from "./AddUnitLink";

/**
 * The register's header acts on a register with units: lend some out, and add
 * one. "Add a unit" stays the page's primary (UX audit 2026-10-07, item 31);
 * "Rent out" sits beside it at secondary weight, the door to lending to
 * somebody who is not on a boat (ADR 20260815-minimal-gear-register, amended
 * 2026-10-08). The empty register keeps its one door in the card instead.
 */
export function RegisterHeaderActions({ shopSlug, t }: { shopSlug: string; t: StaffTranslator }) {
  return (
    <>
      <Link
        href={shopPath(shopSlug, "gear", "rentals", "new")}
        className={buttonClass({ variant: "secondary" })}
      >
        {t("counterRentals.rentOut")}
      </Link>
      <AddUnitLink className={buttonClass()}>{t("gear.addUnit.title")}</AddUnitLink>
    </>
  );
}
