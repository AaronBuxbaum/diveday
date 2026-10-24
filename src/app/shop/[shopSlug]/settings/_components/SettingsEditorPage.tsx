import type { ReactNode } from "react";
import { FlashParams } from "@/components/FlashParams";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { StaffNoticeBanner } from "@/components/StaffNoticeBanner";
import { SectionCard } from "@/components/ui/card";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { NoticeTone } from "@/lib/staff-notices";
import { settingsPaneClass } from "./settings-pane";

/**
 * **One editor on a page of its own, hung off the settings hub** — the shape
 * `/settings/boats` set and the five editors #1854 moved out of hub rows
 * follow: the eyebrow back to the hub, the page's title, what the setting is
 * for under it, the action's `?notice=` as a banner, and the editor in one
 * card at the hub's width. A collection passes `unframed` and owns its row
 * groups instead, so their list shells are never nested inside another card.
 */
export function SettingsEditorPage({
  shopSlug,
  t,
  title,
  description,
  banner,
  actions,
  unframed = false,
  children,
}: {
  shopSlug: string;
  t: StaffTranslator;
  title: string;
  /** What the setting is for, which the hub row showed once it was opened. */
  description?: string;
  banner: { tone: NoticeTone; text: string } | undefined;
  /** The header's own actions, such as a text link out to what the page edits. */
  actions?: ReactNode;
  /** A collection owns its list shells; singleton editors use the default card. */
  unframed?: boolean;
  children: ReactNode;
}) {
  return (
    <main className={settingsPaneClass()}>
      <FlashParams params={["notice"]} />
      <ShopPageHeader
        eyebrow={t("settings.main.eyebrow")}
        eyebrowHref={`/shop/${shopSlug}/settings`}
        title={title}
        description={description}
        descriptionIsCaption
        actions={actions}
      />
      {banner ? <StaffNoticeBanner tone={banner.tone}>{banner.text}</StaffNoticeBanner> : null}
      {unframed ? children : <SectionCard padding="lg">{children}</SectionCard>}
    </main>
  );
}
