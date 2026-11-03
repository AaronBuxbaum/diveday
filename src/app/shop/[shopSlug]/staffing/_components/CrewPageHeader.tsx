import Link from "next/link";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";

/**
 * The Crew view's header, and its one door: Print, to the week's rota as a
 * sheet of the shop's paper (`staffing/print`, issue #2745). The screen is
 * never the paper; the noticeboard gets the sheet.
 */
export function CrewPageHeader({
  printHref,
  t,
}: {
  /** The rota sheet for the week on screen. */
  printHref: string;
  t: (key: "schedule.boardTitle" | "print.sheet.door") => string;
}) {
  return (
    <ShopPageHeader
      title={t("schedule.boardTitle")}
      actions={
        <Link href={printHref} className={buttonClass({ variant: "secondary", size: "sm" })}>
          {t("print.sheet.door")}
        </Link>
      }
    />
  );
}
