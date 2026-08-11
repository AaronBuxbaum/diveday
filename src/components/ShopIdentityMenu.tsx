"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { isDestinationCurrent, type ShopNavGates } from "@/components/ShopNavLinks";
import { buttonClass } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { staffDestination, staffDestinationHref } from "@/lib/staff-destinations";

export type ShopIdentityMenuCopy = {
  settings: string;
  signOut: string;
  signOutConfirm: string;
  signOutPending: string;
};

/**
 * The staff header's identity block — logo and shop name — as a small
 * disclosure holding everything that is about *this shop and this session*
 * rather than about the dive day.
 *
 * Sign out was the first thing filed here: it used to stand in the permanent
 * header at equal standing with Search, chrome on screen all day for a control
 * most staffers tap once a shift, and the remove-until-it-breaks test (design
 * principle 10) took it. Settings is the second, and for the same reason one
 * step further on — it was a tab, which on a phone means a sixth of the bottom
 * dock, permanently, for the one destination a shop *configures* rather than
 * works. Behind the shop's own name it is still one tap from anywhere at every
 * width, and it reads as what it is.
 *
 * The sign-out itself keeps its two-tap `InlineConfirm` (task 81): an undo
 * banner is not safe here, because its grace window would keep the session
 * alive briefly on a device the next person is already holding (principle 7).
 */
export function ShopIdentityMenu({
  shopName,
  root,
  gates,
  signOutAction,
  copy,
}: {
  shopName: string;
  /** `/shop/<slug>`, for the destinations filed in here. */
  root: string;
  /** Settings is owner/manager work (H-14) — hidden entirely from everyone else. */
  gates: ShopNavGates;
  signOutAction: () => Promise<void>;
  copy: ShopIdentityMenuCopy;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // A disclosed menu dismisses like any other: Escape hands focus back to
  // the trigger, a tap anywhere else simply closes it. Listeners exist only
  // while it is open (same pattern as the board's row menus).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Close on any (re)navigation, so an Activity-preserved re-show can never
  // resurface an open session menu (same defensive pattern as InlineConfirm).
  const pathname = usePathname();
  // Read from the one registry, gate and `alsoMatch` included, so this door
  // can never drift from the tabs and the palette (src/lib/staff-destinations.ts).
  // `alsoMatch` is what keeps Promo codes, Dive sites and Waivers — reached
  // *from* Settings' cards — marking the door that leads back to them.
  const settings = staffDestination("settings");
  const showSettings = gates.settings;
  const settingsCurrent = showSettings && isDestinationCurrent(pathname, root, settings);
  const pathnameEffectRan = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a trigger, not a value the effect body reads — any change closes the menu, which is the point.
  useEffect(() => {
    if (!pathnameEffectRan.current) {
      pathnameEffectRan.current = true;
      return;
    }
    setOpen(false);
  }, [pathname]);

  return (
    // `flex`, so the trigger below is a flex item and shrinks when the header
    // is tight. A `<button>` sizes to fit its content even at `display: flex`,
    // so as a block child it would simply overflow this box instead of letting
    // the name inside it truncate.
    <div ref={rootRef} className="relative flex min-w-0 shrink">
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        // The stable hook the e2e helpers open the menu by — the accessible
        // name is the shop's own (variable) name, deliberately.
        data-identity-menu
        className="flex min-h-11 min-w-0 shrink cursor-pointer items-center gap-2 font-semibold tracking-tight"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm transition-transform duration-200 hover:rotate-6">
          <LogoMark className="size-5" />
        </span>
        {/* No fixed clamp at any width. The 10rem one that survived at `lg`
            was sized when the header still carried wrapped tab rows and a
            standing Sign out, and it was ellipsing names — "Sandbar Pass
            Aquatics" cut to "Sandbar Pass Aquat…" — on a 1440px header with
            several hundred pixels of empty row to its right. Flex owns the
            width instead: this item is `shrink` inside a row whose other
            children are `shrink-0`, so the name truncates only when the row
            genuinely runs out of space, which is the only time it should. */}
        <span className="min-w-0 truncate">{shopName}</span>
        {/* The one visual cue that the identity block opens: a small caret,
            rotating with state (transform-only, ≤250ms, principle 5). */}
        <span
          aria-hidden="true"
          className={`text-xs text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open ? (
        <div className="absolute top-full left-0 z-10 mt-2 min-w-44 rounded-xl border border-border bg-surface p-2 shadow-lg animate-scale-in">
          {showSettings ? (
            <Link
              href={staffDestinationHref(root, settings)}
              aria-current={settingsCurrent ? "page" : undefined}
              onClick={() => setOpen(false)}
              className={buttonClass({
                variant: "ghost",
                size: "sm",
                className: `w-full justify-start rounded-lg ${
                  settingsCurrent ? "bg-primary/10 text-primary" : ""
                }`,
              })}
            >
              {copy.settings}
            </Link>
          ) : null}
          {/* Signing out is the destructive end of the menu, so it sits below
              the rule rather than in the same stack as a navigation row. */}
          <form
            action={signOutAction}
            data-scroll-reset="true"
            className={showSettings ? "mt-1 border-t border-border pt-1" : ""}
          >
            <InlineConfirm
              triggerLabel={copy.signOut}
              confirmLabel={copy.signOutConfirm}
              pendingLabel={copy.signOutPending}
              // `justify-start`: the menu is a list of rows now, and a
              // centered label beside a left-aligned one reads as two
              // different kinds of thing.
              triggerClassName={buttonClass({
                variant: "ghost",
                size: "sm",
                className: "w-full justify-start rounded-lg",
              })}
              confirmClassName={buttonClass({
                variant: "danger",
                size: "sm",
                className: "w-full justify-start rounded-lg",
              })}
              autoResetMs={4000}
            />
          </form>
        </div>
      ) : null}
    </div>
  );
}
