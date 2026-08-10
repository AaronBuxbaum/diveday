"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/Logo";
import { buttonClass } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";

export type ShopIdentityMenuCopy = {
  signOut: string;
  signOutConfirm: string;
  signOutPending: string;
};

/**
 * The staff header's identity block — logo and shop name — as a small
 * disclosure holding the session actions. Sign out used to stand in the
 * permanent header at equal standing with Search, chrome that is on screen
 * all day for a control most staffers tap once a shift; the
 * remove-until-it-breaks test (design principle 10) took it first. Behind the
 * identity block it stays one tap from anywhere, for every role, on shared
 * boat and front-desk devices alike — while the header at rest reads
 * identity + Search only.
 *
 * The sign-out itself keeps its two-tap `InlineConfirm` (task 81): an undo
 * banner is not safe here, because its grace window would keep the session
 * alive briefly on a device the next person is already holding (principle 7).
 */
export function ShopIdentityMenu({
  shopName,
  signOutAction,
  copy,
}: {
  shopName: string;
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
    <div ref={rootRef} className="relative min-w-0 shrink">
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
        <span className="max-w-40 truncate">{shopName}</span>
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
          <form action={signOutAction} data-scroll-reset="true">
            <InlineConfirm
              triggerLabel={copy.signOut}
              confirmLabel={copy.signOutConfirm}
              pendingLabel={copy.signOutPending}
              triggerClassName={buttonClass({
                variant: "ghost",
                size: "sm",
                className: "w-full rounded-lg",
              })}
              confirmClassName={buttonClass({
                variant: "danger",
                size: "sm",
                className: "w-full rounded-lg",
              })}
              autoResetMs={4000}
            />
          </form>
        </div>
      ) : null}
    </div>
  );
}
