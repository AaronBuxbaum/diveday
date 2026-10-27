import type { ReactNode } from "react";
import { StaffPage } from "@/app/shop/[shopSlug]/_components/StaffPage";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { BoardHeaderActions } from "./BoardHeaderActions";

/** The board is full-width; the standalone creation form has a reading measure. */
export function BoardPageShell({
  createPage,
  boardHref,
  hasUpcoming,
  canConfigure,
  shopSlug,
  returnWeek,
  st,
  children,
}: {
  createPage: boolean;
  boardHref: string;
  hasUpcoming: boolean;
  canConfigure: boolean;
  shopSlug: string;
  returnWeek?: string;
  st: StaffTranslator;
  children: ReactNode;
}) {
  return (
    <StaffPage width={createPage ? "reading" : "full"}>
      <ShopPageHeader
        eyebrow={createPage ? st("schedule.boardTitle") : undefined}
        eyebrowHref={createPage ? boardHref : undefined}
        title={st(createPage ? "schedule.builder.addDeparture" : "schedule.boardTitle")}
        actions={
          !createPage && hasUpcoming ? (
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
