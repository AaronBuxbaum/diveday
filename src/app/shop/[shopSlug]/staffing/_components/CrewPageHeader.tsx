import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SHELL_TITLE_CLASS } from "@/components/ui/typography";

/** Schedule on screen; a named shop rota when pinned to a noticeboard. */
export function CrewPageHeader({
  shopName,
  t,
}: {
  shopName: string;
  t: (key: "schedule.boardTitle" | "schedule.views.crew") => string;
}) {
  return (
    <>
      <div className="print:hidden">
        <ShopPageHeader title={t("schedule.boardTitle")} />
      </div>
      <header className="mb-4 hidden border-b border-border pb-3 print:block">
        <p className="text-sm font-medium">{shopName}</p>
        <h1 className={SHELL_TITLE_CLASS}>{t("schedule.views.crew")}</h1>
      </header>
    </>
  );
}
