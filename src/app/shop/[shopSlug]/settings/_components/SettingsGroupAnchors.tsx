import { buttonClass } from "@/components/ui/button";
import { SETTINGS_GROUPS, type SettingsGroupId } from "../settings-groups";

/**
 * The settings hub's jump row: one anchor per group, into the section of the
 * page it names. Order and names come from `settings-groups.ts`, the same list
 * the hub's own sections derive from, so the row can never offer a jump to a
 * section that isn't there.
 *
 * Plain same-document anchors, which the browser handles itself: no
 * re-render, no refetch, and they work before JavaScript arrives — the same
 * reasoning `JumpNav` (src/components/JumpNav.tsx) recorded.
 *
 * **`JumpNav` is not retired**, which an earlier version of this note claimed:
 * it has two live callers, the diver record and the public course page. The two
 * therefore render one act, and they render it at one weight — `link`, which is
 * `JumpNav`'s and which the variant exists for ("reads as inline text, but
 * still claims a full touch target", components/ui/button.ts). This row used to
 * hand-roll `ghost`/`sm` instead, so the same "places on this page" control read
 * as muted chrome here and as a link everywhere else. What stays different is
 * only structure: `JumpNav` owns a hairline rule and a `print:hidden` wrapper it
 * needs on a record that gets printed; this row sits above the hub's `<h1>` with
 * neither.
 *
 * This is the whole of what the settings sub-nav became. It used to also
 * render, on each of the six full-page sub-pages, a grouped pill card of every
 * settings destination above that page's `<h1>` — a directory the hub renders
 * better, repeated as permanent chrome on pages whose actual need was one
 * thing: the way back. That is the eyebrow's job now (`ShopPageHeader`'s
 * `eyebrowHref`), which costs no chrome at all, sits in each page's own column
 * at each page's own width, and leaves this row where it was always honest —
 * on the page whose sections it points at.
 */
export function SettingsGroupAnchors({
  ariaLabel,
  groupLabels,
  className = "",
}: {
  ariaLabel: string;
  groupLabels: Record<SettingsGroupId, string>;
  className?: string;
}) {
  return (
    // `-ml-3` cancels the first anchor's own padding so its label lines up
    // optically with the `<h1>` beneath it.
    <nav aria-label={ariaLabel} className={`-ml-3 flex flex-wrap gap-1 ${className}`}>
      {SETTINGS_GROUPS.map((group) => (
        <a
          key={group.id}
          href={`#${group.id}`}
          className={buttonClass({ variant: "link", size: "sm" })}
        >
          {groupLabels[group.id]}
        </a>
      ))}
    </nav>
  );
}
