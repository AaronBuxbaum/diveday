import { ShopNotice } from "@/components/ShopPageHeader";
import { type NoticeTone, noticeRole } from "@/lib/staff-notices";

/**
 * The shared render half of the `?notice=` banner pattern (see
 * `src/lib/staff-notices.ts`): the `mb-6`-spaced wrapper and the
 * tone→role mapping that most notice banners across `/shop/**` already
 * rendered identically, one hand-copied `<div className="mb-6">…</div>`
 * at a time. Pages whose banner has its own layout (an inline undo button,
 * no outer spacing div, a different default role) keep their own JSX and
 * use only `noticeFromParam` for the lookup — forcing this markup onto them
 * would change what's actually on screen, not just deduplicate plumbing.
 */
export function StaffNoticeBanner({
  tone,
  children,
}: {
  tone: NoticeTone;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-6">
      <ShopNotice tone={tone} role={noticeRole(tone)}>
        {children}
      </ShopNotice>
    </div>
  );
}
