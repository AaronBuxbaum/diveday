"use client";

import { unstable_rethrow } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { MENU_PANEL } from "@/components/ui/menu";
import { useMenuDismissal } from "@/components/useMenuDismissal";
import { log } from "@/lib/log";

/** One role's row, resolved server-side (name is data, the title is translated copy). */
interface DemoRoleInfo {
  id: "owner" | "instructor" | "divemaster" | "captain" | "diver";
  name: string;
  title: string;
  /** "Switch to {title}" pre-formatted server-side — functions can't cross into a Client Component. */
  switchAriaLabel: string;
}

interface DemoBannerCopy {
  shopLabel: string;
  viewingAs: string;
  switchRole: string;
  sharedWarning: string;
  current: string;
  switchAction: string;
  /** Shown when `switchDemoRoleAction` throws — the tap must not fail silently. */
  switchFailed: string;
}

interface DemoBannerProps {
  currentRole: "owner" | "instructor" | "divemaster" | "captain" | "diver";
  currentName?: string | null;
  shopSlug: string;
  /** Every role this shop can show, in display order, already filtered to who's seeded. */
  roles: DemoRoleInfo[];
  copy: DemoBannerCopy;
  /**
   * A per-visitor minted demo (not the shared fixture): addressable by slug and
   * readable by anyone who has it, so it shows a "don't enter real data" notice.
   */
  isMintedDemo?: boolean;
  /**
   * The switch-role server action, passed down by the layout. Shared components
   * never import from `src/app` (pnpm check:architecture) — the route that owns
   * the surface hands its actions in as props.
   */
  switchRole: (roleId: string, shopSlug: string) => Promise<void>;
}

export function DemoBanner({
  currentRole,
  currentName,
  shopSlug,
  roles,
  copy,
  isMintedDemo = false,
  switchRole,
}: DemoBannerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The picker dismisses like every staff menu: an outside tap, or Escape with
  // focus handed back to "Switch role" (useMenuDismissal).
  const close = useCallback(() => setIsExpanded(false), []);
  useMenuDismissal({ open: isExpanded, close, inside: [rootRef], returnFocus: triggerRef });
  const [isPending, startTransition] = useTransition();
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchFailed, setSwitchFailed] = useState(false);

  const activeInfo = roles.find((r) => r.id === currentRole);

  const handleRoleSwitch = (roleId: string) => {
    if (roleId === currentRole) return;
    setSwitchingTo(roleId);
    setSwitchFailed(false);
    startTransition(async () => {
      try {
        await switchRole(roleId, shopSlug);
      } catch (err) {
        // The action ends every path — success included — in `redirect()`,
        // whose sentinel reaches this catch on the client too. Without the
        // rethrow a switch that worked still painted "didn't go through" under
        // the new role's page.
        unstable_rethrow(err);
        log("demo.role_switch_failed", "warn", {
          errorCode: err instanceof Error ? err.name : "unknown_error",
        });
        // The panel has already closed by now — say so in the banner itself,
        // not only in a console nobody on a demo is watching.
        setSwitchFailed(true);
      } finally {
        setSwitchingTo(null);
      }
    });
    setIsExpanded(false);
  };

  return (
    <div className="border-b border-accent/40 bg-accent/5 transition-all print:hidden">
      {/* The chrome bar's own row (`ChromeBar`: `max-w-6xl … px-4 sm:px-6`), so
          the banner's words start on the bar's edge and the page's, not in a
          narrower column of their own. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-3 sm:px-6">
        {/*
         * One wrapping row, not a phone-only column. The column put "Switch
         * role" on a line of its own pinned hard right (`self-end`), so on a
         * phone the ribbon read as a stray button floating in a band of empty
         * space, disconnected from the sentence it belongs to. Wrapping keeps
         * it on the same line whenever there is room and drops it directly
         * under the text — left-aligned with everything else — when there
         * isn't. `justify-between` still pushes it to the far edge on the wide
         * single-line layout, which is where it has always sat.
         */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            {/* `Badge`, not a hand-rolled chip: the chip's 6px corner sat off the
                radius ladder. A label rather than a caution, so no tone mark. */}
            <Badge
              tone="warning"
              size="sm"
              toneMark={false}
              wraps
              className="max-w-full break-words tracking-wide uppercase"
            >
              {copy.shopLabel}
            </Badge>
            {/* Below `sm` the row is the badge, the role and the switch on one
                line: "Viewing as" and the person's name are the desktop's
                spelling of what the badge and the role already say, and on a
                phone they pushed the switch onto a second row above every page. */}
            <p className="text-sm text-foreground">
              <span className="max-sm:sr-only">{copy.viewingAs} </span>
              <span className="font-semibold text-primary">{activeInfo?.title}</span>
              {/* One unit: the name wraps whole, never leaving "Reyes)" alone on a
                  line, so the space before it sits outside the unbreakable span. */}
              {currentName && currentRole !== "diver" ? (
                <>
                  {" "}
                  <span className="whitespace-nowrap text-muted text-xs max-sm:hidden">
                    ({currentName})
                  </span>
                </>
              ) : null}
            </p>
          </div>

          {/* **A popover, anchored to its button** (visual review 2026-10-24,
              A41): the picker floats over the page rather than opening a band
              that pushed every page down by a screen of role cards. One row
              per role: its name, the sample person, and Switch; the role in
              force reads "Current" and is not a control. */}
          <div ref={rootRef} className="relative shrink-0">
            <button
              type="button"
              ref={triggerRef}
              onClick={() => setIsExpanded((open) => !open)}
              aria-expanded={isExpanded}
              aria-controls="demo-role-picker"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              {copy.switchRole}
              <DiveDayIcon
                name="arrow-down"
                className={`size-3 ${isExpanded ? "rotate-180" : ""}`}
              />
            </button>
            {isExpanded ? (
              <div
                id="demo-role-picker"
                className={`absolute end-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] animate-scale-in ${MENU_PANEL}`}
              >
                <ul className="divide-y divide-border">
                  {roles.map((role) => {
                    const isActive = role.id === currentRole;
                    return (
                      <li
                        key={role.id}
                        className="flex min-h-11 items-center justify-between gap-3 px-3 py-1.5"
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-foreground">
                            {role.title}
                          </span>
                          {role.id === "diver" ? null : (
                            <span className="block text-xs text-muted">{role.name}</span>
                          )}
                        </span>
                        {isActive ? (
                          <span className="shrink-0 text-sm text-muted">{copy.current}</span>
                        ) : (
                          <button
                            type="button"
                            disabled={isPending}
                            aria-label={role.switchAriaLabel}
                            aria-busy={switchingTo === role.id || undefined}
                            onClick={() => handleRoleSwitch(role.id)}
                            className={buttonClass({
                              variant: "ghost",
                              size: "sm",
                              flush: true,
                              className: "shrink-0",
                            })}
                          >
                            {copy.switchAction}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        {switchFailed ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {copy.switchFailed}
          </p>
        ) : null}

        {isMintedDemo ? (
          <div className="mt-2 text-xs text-muted">
            <p>{copy.sharedWarning}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
