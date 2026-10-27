"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type LanguageChoice, LanguageChoices } from "@/components/LanguageChoices";
import { DiveDayIcon } from "@/components/StaffDestinationIcon";
import { GroupLabel } from "@/components/ui/group-label";
import { MENU_PANEL, MENU_TICK_GUTTER } from "@/components/ui/menu";
import { useExitAnimation } from "@/components/useExitAnimation";
import { motionMs } from "@/lib/motion";

export type LanguagePickerCopy = {
  /** Names the control for a screen reader — "Change language". */
  ariaLabel: string;
  /** Heads the open panel. */
  heading: string;
};

type PanelPlacement = {
  top: number;
  left: number;
  maxHeight: number;
  maxWidth: number;
  minWidth: number;
  upward: boolean;
};

/**
 * The public header's language control: one trigger naming the language you
 * are reading in, opening the full list.
 *
 * **Why not the row of buttons this replaces.** The header used to render one
 * `<button>` per language DiveDay carries *other than the one in force* — which
 * at two locales is exactly one button, reading "español", and that shape only
 * works at two. It is a swap, not a choice: it cannot say which language you
 * are currently in (there is no control for the one in force), and the moment a
 * third locale lands it becomes two, then three, unlabelled buttons competing
 * with the shop's own navigation for the width of a phone header — with no way
 * to tell that they are alternatives to each other rather than destinations.
 *
 * A trigger plus a panel is the same shape at two languages and at twelve.
 * From `sm` up the trigger carries the current language's own name for itself,
 * so a reader who cannot read a word of the header can still see which language
 * they are in and that this is where language lives. On a phone that name is
 * `sr-only` and the globe carries the control alone — a header that squeezed
 * the *shop's* name to keep this one would be trading the identity a diver came
 * for against a label the globe already says without words. Inside, every
 * language is listed — including the one in force, marked `aria-current` —
 * because "which am I in?" is a question the control should be able to answer,
 * and on the phone it is the only place that answers it.
 *
 * Dismissal follows the staff header's identity menu exactly (Escape returns
 * focus to the trigger, a pointer down anywhere else closes): two disclosures
 * in the same position on two headers should not behave differently.
 */
export function LanguagePicker({
  current,
  currentLabel,
  choices,
  setLocale,
  copy,
}: {
  /** The language this page was written in. */
  current: string;
  /** That language's own name for itself, shown on the trigger. */
  currentLabel: string;
  /** Every language DiveDay carries, each named in itself — the current one included. */
  choices: readonly LanguageChoice[];
  setLocale: (locale: string) => Promise<void>;
  copy: LanguagePickerCopy;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<PanelPlacement>();
  // 180ms matches .animate-scale-out in globals.css — the two must move together.
  const { mounted, closing } = useExitAnimation(open, motionMs("base"));

  // Like RowMenu, place before paint and flip when the lower side cannot fit.
  // Scroll height plus borders is the full list even after a short viewport
  // caps it; transformed animation bounds would underestimate its final size.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!mounted || !panel) {
      setPlacement(undefined);
      return;
    }
    const position = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const root = rootRef.current?.getBoundingClientRect();
      const naturalHeight = panel.scrollHeight + panel.offsetHeight - panel.clientHeight;
      if (!trigger || !root || naturalHeight <= 0) return;
      const fontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const edge = fontSize / 2;
      const gap = fontSize / 4;
      const viewportHeight = Math.max(0, window.innerHeight - edge * 2);
      const below = Math.max(
        0,
        Math.min(viewportHeight, window.innerHeight - edge - trigger.bottom - gap),
      );
      const above = Math.max(0, Math.min(viewportHeight, trigger.top - edge - gap));
      const upward = naturalHeight > below && above > below;
      const maxHeight = upward ? above : below;
      const height = Math.min(naturalHeight, maxHeight);
      const maxWidth = Math.max(0, window.innerWidth - edge * 2);
      const width = Math.min(panel.offsetWidth, maxWidth);
      const left = Math.max(
        edge,
        Math.min(trigger.right - width, window.innerWidth - edge - width),
      );
      const desiredTop = upward ? trigger.top - gap - height : trigger.bottom + gap;
      const top = Math.max(edge, Math.min(desiredTop, window.innerHeight - edge - height));
      const next = {
        top: top - root.top,
        left: left - root.left,
        maxHeight,
        maxWidth,
        minWidth: Math.min(fontSize * 10, maxWidth),
        upward,
      };
      setPlacement((previous) =>
        previous?.top === next.top &&
        previous.left === next.left &&
        previous.maxHeight === next.maxHeight &&
        previous.maxWidth === next.maxWidth &&
        previous.minWidth === next.minWidth &&
        previous.upward === next.upward
          ? previous
          : next,
      );
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(panel);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    // The wrapping public header can move this trigger without resizing it.
    // This absolute panel does not contribute to that header's height.
    const header = rootRef.current?.closest("header");
    if (header) observer?.observe(header);
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer?.disconnect();
    };
  }, [mounted]);

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

  return (
    <div ref={rootRef} className="relative flex shrink-0">
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={copy.ariaLabel}
        className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-1.5 text-sm font-medium text-muted transition-colors hover:bg-surface-sunken hover:text-foreground sm:px-2"
      >
        {/* `min-w-11 justify-center`: below `sm` the globe is the whole visible
            control, and without a width floor the target shrank to the glyph
            and its padding, 28×44. The 16px it gains comes out of the shop
            name beside it, which already truncates. */}
        {/* The globe is the half of this control that needs no language at
            all — the reader most likely to reach for it is the one who cannot
            read the label beside it. */}
        <DiveDayIcon name="globe" className="size-4 shrink-0" strokeWidth={1.75} />
        {/* `lang` so a screen reader pronounces "Español" as Spanish rather
            than reading it through the page's own language. */}
        <span lang={current} className="sr-only sm:not-sr-only">
          {currentLabel}
        </span>
        {/* Below `sm` the globe carries the control alone: the endonym goes
            `sr-only` and the caret is hidden outright. The public bar can
            wrap (ADR 20260827-clearwater-surface-language, decision 10),
            while the leading identity row belongs to the shop's own name,
            which appears nowhere else above the fold on a shopfront page,
            while this control's meaning survives the squeeze whole: the globe
            is the half that needs no language, `aria-label` and
            `aria-expanded` carry the affordance the caret was drawing, and the
            endonym is still in the accessibility tree. */}
        <DiveDayIcon
          name="caret"
          direction="down"
          className={`hidden size-3 transition-transform sm:block ${open ? "rotate-180" : ""}`}
        />
      </button>
      {mounted ? (
        // The shared menu panel (`ui/menu.ts`), so the language rows nest in
        // its corner, and the heading on the rows' tick gutter, so it starts
        // where the names do.
        <div
          ref={panelRef}
          data-language-menu=""
          data-side={placement?.upward ? "above" : "below"}
          style={
            placement
              ? {
                  top: placement.top,
                  left: placement.left,
                  right: "auto",
                  marginTop: 0,
                  maxHeight: placement.maxHeight,
                  maxWidth: placement.maxWidth,
                  minWidth: placement.minWidth,
                  transformOrigin: placement.upward ? "bottom right" : "top right",
                }
              : undefined
          }
          className={`absolute top-full right-0 z-10 mt-1 min-w-40 overflow-y-auto ${MENU_PANEL} ${closing ? "animate-scale-out" : "animate-scale-in"}`}
        >
          <GroupLabel className={MENU_TICK_GUTTER}>{copy.heading}</GroupLabel>
          <div className="mt-1">
            <LanguageChoices
              current={current}
              choices={choices}
              setLocale={setLocale}
              onChosen={() => setOpen(false)}
              layout="list"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
