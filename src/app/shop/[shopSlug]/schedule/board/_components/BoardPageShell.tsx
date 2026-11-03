import type { ReactNode } from "react";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { BoardHeaderActions } from "./BoardHeaderActions";

/** The board, full-width; its add panel (`?add=1`) opens inside it. */
export function BoardPageShell({
  hasUpcoming,
  canConfigure,
  shopSlug,
  returnWeek,
  st,
  children,
}: {
  hasUpcoming: boolean;
  canConfigure: boolean;
  shopSlug: string;
  returnWeek?: string;
  st: StaffTranslator;
  children: ReactNode;
}) {
  return (
    <StaffPage width="full">
      <ShopPageHeader
        title={st("schedule.boardTitle")}
        actions={
          hasUpcoming ? (
            <BoardHeaderActions
              st={st}
              shopSlug={shopSlug}
              canConfigure={canConfigure}
              week={returnWeek}
            />
          ) : undefined
        }
      />
      {children}
    </StaffPage>
  );
}
