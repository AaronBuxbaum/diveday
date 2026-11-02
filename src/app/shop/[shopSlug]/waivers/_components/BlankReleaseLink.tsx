import Link from "next/link";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { shopPath } from "@/lib/staff-notices";

/** The door to the counter's paper: this version, blank (issue #2972). */
export function BlankReleaseLink({ shopSlug, t }: { shopSlug: string; t: StaffTranslator }) {
  return (
    <p className="mb-4 text-sm">
      <Link
        href={shopPath(shopSlug, "waivers", "print")}
        className="font-medium text-primary hover:underline"
      >
        {t("waiversStaff.blank.link")}
      </Link>
    </p>
  );
}
