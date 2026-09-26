import { RAIL_ROW_BOX } from "@/components/ui/rail";
import { SETTINGS_GROUPS, SETTINGS_RAIL_ROWS } from "../settings-groups";
import {
  SETTINGS_RAIL_COLUMN_CLASS,
  SETTINGS_RAIL_CONTENT_CLASS,
  SETTINGS_RAIL_FRAME_CLASS,
  SETTINGS_RAIL_LABEL_CLASS,
  SETTINGS_RAIL_LABEL_WORDS_CLASS,
} from "./settings-rail-geometry";

/**
 * **The rail, drawn as bars**, while `SettingsRailPanel`'s session, shop and
 * permission reads stream in (`settings/layout.tsx`).
 *
 * Every box is the rail's own (`settings-rail-geometry.ts`, and the page
 * rail's `RAIL_ROW_BOX`), so the rail lands exactly where its bars were
 * (pixel-craft class 11). Each group draws as many rows as the whole map has
 * for it, which is the rail an owner sees; the sticky box is no taller than
 * the viewport, so the rows past its fold are clipped here as they are
 * scrolled away there. The bars are each line's own height: `h-4` a text-xs
 * label's line, `h-5` a text-sm row's.
 */
export function SettingsRailSkeleton() {
  return (
    <div className={SETTINGS_RAIL_COLUMN_CLASS} aria-hidden="true">
      <div className={`${SETTINGS_RAIL_FRAME_CLASS} animate-pulse overflow-hidden`}>
        <div className={SETTINGS_RAIL_CONTENT_CLASS}>
          {SETTINGS_GROUPS.map((group) => (
            <div key={group.id}>
              <div className={SETTINGS_RAIL_LABEL_CLASS}>
                <div className={SETTINGS_RAIL_LABEL_WORDS_CLASS}>
                  <div className="h-4 w-24 rounded bg-surface-sunken" />
                </div>
              </div>
              {SETTINGS_RAIL_ROWS.filter((row) => row.group === group.id).map((row) => (
                <div key={row.id} className={RAIL_ROW_BOX}>
                  <div className="h-5 w-36 rounded bg-surface-sunken" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
