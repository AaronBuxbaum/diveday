"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { type LanguageChoice, LanguageChoices } from "@/components/LanguageChoices";
import { LogoMark } from "@/components/Logo";
import { buttonClass } from "@/components/ui/button";
import { InlineConfirm } from "@/components/ui/InlineConfirm";

export type ShopIdentityMenuCopy = {
  language: string;
  signOut: string;
  signOutConfirm: string;
  signOutPending: string;
};

/**
 * The staff header's identity block — logo and shop name — as a small
 * disclosure holding what is about *this reader, this device, this session*:
 * the language the app speaks to them, and the way out. Nothing in it is a
 * place in the shop.
 *
 * Sign out was the first thing filed here: it used to stand in the permanent
 * header at equal standing with Search, chrome on screen all day for a control
 * most staffers tap once a shift, and the remove-until-it-breaks test (design
 * principle 10) took it.
 *
 * Language belongs here for the same reason: it is about *this reader on this
 * device*, not about the dive day. It is also the one control a person who
 * cannot read the rest of the header needs to find, which is why the options
 * render as their own languages' names rather than as words in whichever
 * language is currently wrong for them.
 *
 * Settings lived here for a while, between leaving the tab strip and the
 * "More" groups arriving — it is a *place*, and places live in the nav: the
 * header's More menu and the dock's More sheet both end their "Set up" group
 * with it (ADR 20260813-more-is-the-shops-other-door). Keeping a second door
 * here too would be the duplicate control principle 8 forbids.
 *
 * The sign-out itself keeps its two-tap `InlineConfirm` (task 81): an undo
 * banner is not safe here, because its grace window would keep the session
 * alive briefly on a device the next person is already holding (principle 7).
 */
export function ShopIdentityMenu({
  shopName,
  signOutAction,
  locale,
  languages,
  setLocaleAction,
  copy,
}: {
  shopName: string;
  signOutAction: () => Promise<void>;
  /** The language this render was written in — the one marked as in force. */
  locale: string;
  /** Every language DiveDay carries, each named in itself. */
  languages: readonly LanguageChoice[];
  setLocaleAction: (locale: string) => Promise<void>;
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
          <div className="pt-1">
            <p className="px-2 text-xs font-semibold tracking-wide text-muted uppercase">
              {copy.language}
            </p>
            <div className="mt-1">
              <LanguageChoices
                current={locale}
                choices={languages}
                setLocale={setLocaleAction}
                onChosen={() => setOpen(false)}
              />
            </div>
          </div>
          {/* Signing out is the destructive end of the menu, so it sits below
              the rule rather than in the same stack as the language rows. */}
          <form
            action={signOutAction}
            data-scroll-reset="true"
            className="mt-1 border-t border-border pt-1"
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
