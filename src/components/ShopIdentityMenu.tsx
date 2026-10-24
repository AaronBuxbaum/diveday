"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { type LanguageChoice, LanguageChoices } from "@/components/LanguageChoices";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { GroupLabel } from "@/components/ui/group-label";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { MENU_PANEL, MENU_TICK_GUTTER, menuRowClass } from "@/components/ui/menu";
import { useExitAnimation } from "@/components/useExitAnimation";
import { useMenuDismissal } from "@/components/useMenuDismissal";
import { motionMs } from "@/lib/motion";
import { tellUsMailto, tellUsPath } from "@/lib/tell-us";
import { forgetThisDevice } from "./forget-device";

export type ShopIdentityMenuCopy = {
  language: string;
  /** "Account settings": the reader's own sign-in page. */
  accountSettings: string;
  signOut: string;
  signOutConfirm: string;
  signOutPending: string;
  /** "Send feedback": the row that opens a note to DiveDay support. */
  tellUs: string;
  /** The note's subject, the shop's slug already in it. */
  tellUsSubject: string;
  /** The body's opening line, with `{path}` where the page's path goes. */
  tellUsBody: string;
};

/**
 * Where "Tell us" writes to, and the shop it is about. Optional, so a test that
 * is about the language rows need not invent a mailbox.
 */
export type TellUsTarget = {
  to: string;
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
 * **Settings left again, for the nav** (ADR 20261001-logbook): it has its own
 * row at the sidebar's foot, and a second door here would be the duplicate
 * control principle 8 forbids. **One account row** (visual review 2026-10-24,
 * A42): the menu reads Language, Account settings, Send feedback, Sign out.
 * The calendar feed and email settings are reached from the account page, and
 * boat mode is a row on Settings.
 *
 * The sign-out itself keeps its two-tap `InlineConfirm` (task 81): an undo
 * banner is not safe here, because its grace window would keep the session
 * alive briefly on a device the next person is already holding (principle 7).
 */
export function shopInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "DD";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function ShopIdentityMenu({
  shopName,
  logoUrl,
  signOutAction,
  locale,
  languages,
  setLocaleAction,
  tellUs,
  accountHref,
  copy,
}: {
  shopName: string;
  logoUrl?: string;
  signOutAction: () => Promise<void>;
  /** The language this render was written in — the one marked as in force. */
  locale: string;
  /** Every language DiveDay carries, each named in itself. */
  languages: readonly LanguageChoice[];
  setLocaleAction: (locale: string) => Promise<void>;
  tellUs?: TellUsTarget;
  /** The reader's own account page (`/settings/security`). */
  accountHref?: string;
  copy: ShopIdentityMenuCopy;
}) {
  const [open, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // This client boundary hydrates separately from Search and the section nav.
  // The sign-out helper waits on the trigger before its first click.
  useEffect(() => setHydrated(true), []);

  // A disclosed menu dismisses like any other — outside tap, Escape with
  // focus back on the trigger, close on navigation — via the one shared
  // contract every staff menu uses (useMenuDismissal).
  const close = useCallback(() => setOpen(false), []);
  const signOutForgetting = useCallback(async () => {
    await forgetThisDevice();
    await signOutAction();
  }, [signOutAction]);
  useMenuDismissal({ open, close, inside: [rootRef], returnFocus: triggerRef });
  // 180ms matches .animate-scale-out in globals.css — the two must move together.
  const { mounted, closing } = useExitAnimation(open, motionMs("base"));
  const initials = shopInitials(shopName);

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
        data-hydrated={hydrated ? "true" : undefined}
        // **Drawn like the bar's other controls**: `rounded-lg`, so the global
        // ring follows a 12px corner rather than a square one, and a hover
        // fill with 8px of room round the mark and the name. The room is
        // handed back at the start (`-ms-2`), so the mark stays on the bar's
        // gutter. At the end, below `lg`, it is what the fold needs: when the
        // name and caret fold to nothing on scroll, the page's title lands
        // where this box ends — 8px past the mark, where the name's first
        // letter sat — and `min-w-11` keeps the folded door a 44px target.
        // From `lg` up the bar never folds, so the end is handed back too
        // (`lg:-me-2`) and the three times beside it stay where they stood.
        className="-ms-2 flex min-h-11 min-w-11 shrink cursor-pointer items-center gap-2 rounded-lg px-2 font-semibold tracking-tight transition-colors hover:bg-surface-sunken lg:-me-2"
      >
        {logoUrl ? (
          <span className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-surface transition-transform hover:rotate-6">
            {/* biome-ignore lint/performance/noImgElement: dynamic user-uploaded logo */}
            <img src={logoUrl} alt="" className="size-full object-cover" />
          </span>
        ) : (
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-xs font-bold uppercase tracking-wider text-primary-foreground transition-transform hover:rotate-6">
            {initials}
          </span>
        )}
        {/* No fixed clamp at any width. The 10rem one that survived at `lg`
            was sized when the header still carried wrapped tab rows and a
            standing Sign out, and it was ellipsing names — "Sandbar Pass
            Aquatics" cut to "Sandbar Pass Aquat…" — on a 1440px header with
            several hundred pixels of empty row to its right. Flex owns the
            width instead: this item is `shrink` inside a row whose other
            children are `shrink-0`, so the name truncates only when the row
            genuinely runs out of space, which is the only time it should. */}
        <span
          // The half of the button the fold takes: below `lg` the name
          // gives way to the page's title as the page scrolls, and the
          // mark stays as the menu's door (ADR
          // 20260907-nothing-from-nowhere, decision 5). It collapses its
          // width as it fades, so nothing invisible is left holding a
          // tap target where a label used to be.
          data-chrome-shop-name
          className="min-w-0 truncate"
        >
          {shopName}
        </span>
        {/* The one visual cue that the identity block opens: a small caret,
            rotating with state (transform-only, ≤250ms, principle 5). */}
        {/* Folds with the name, for the same reason: a caret with no label
            beside it is pointing at nothing. */}
        <span data-chrome-shop-name className="flex shrink-0">
          <DiveDayIcon
            name="caret"
            direction="down"
            className={`size-3 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {mounted ? (
        // The shared menu panel and its rows (`ui/menu.ts`): a `p-1` panel
        // whose rows nest in its corner, and one tick gutter that
        // the LANGUAGE label, the language names and Sign out all start
        // their words on. The rows are not `buttonClass`, whose `rounded-lg`
        // would beat the nested corner in the stylesheet.
        <div
          className={`absolute top-full left-0 z-10 mt-2 min-w-44 ${MENU_PANEL} ${closing ? "animate-scale-out" : "animate-scale-in"}`}
        >
          <div>
            <GroupLabel className={MENU_TICK_GUTTER}>{copy.language}</GroupLabel>
            <div className="mt-1">
              <LanguageChoices
                current={locale}
                choices={languages}
                setLocale={setLocaleAction}
                onChosen={() => setOpen(false)}
                // Stacked, like every other row in this menu — a wrapping row
                // of language buttons inside a 11rem panel reads as a block of
                // chips rather than as the menu's own list, and stops fitting
                // at all past a handful of languages.
                layout="list"
              />
            </div>
          </div>
          {accountHref || tellUs ? (
            <div className="mt-1 border-t border-border pt-1">
              {accountHref ? (
                <Link
                  href={accountHref}
                  onClick={() => setOpen(false)}
                  className={menuRowClass("quiet")}
                >
                  {copy.accountSettings}
                </Link>
              ) : null}
              {tellUs ? <TellUsRow to={tellUs.to} copy={copy} /> : null}
            </div>
          ) : null}
          {/* Signing out is the destructive end of the menu, so it sits below
              the rule rather than in the same stack as the language rows. */}
          <form
            // A shared tablet keeps no recents, kept forms or offline medical
            // alert words past a sign-out; the wipe is awaited before the
            // sign-out navigates away.
            action={signOutForgetting}
            data-scroll-reset="true"
            className="mt-1 border-t border-border pt-1"
          >
            <InlineConfirm
              triggerLabel={copy.signOut}
              confirmLabel={copy.signOutConfirm}
              pendingLabel={copy.signOutPending}
              // Menu rows, start-aligned like every other row here: a
              // centred label beside a left-aligned one reads as two
              // different kinds of thing. Armed, the row warns with a ring,
              // so its words stay on the gutter.
              triggerClassName={menuRowClass("quiet")}
              confirmClassName={menuRowClass("armed")}
              autoResetMs={4000}
            />
          </form>
        </div>
      ) : null}
    </div>
  );
}

/**
 * **Send feedback** (batch 4, M2): a note to DiveDay support, addressed and opened
 * on the page the staffer was reading. Read at click time rather than render
 * time, so the path is the one on screen even after a client navigation.
 * Only the path goes in (`tellUsPath` drops the query string).
 */
function TellUsRow({ to, copy }: { to: string; copy: ShopIdentityMenuCopy }) {
  const pathname = usePathname() ?? "/";
  const href = tellUsMailto({
    to,
    subject: copy.tellUsSubject,
    body: copy.tellUsBody.replace("{path}", tellUsPath(pathname)),
  });
  return (
    <a href={href} data-tell-us="" className={menuRowClass("quiet")}>
      {copy.tellUs}
    </a>
  );
}
