import { DISPLAY_TITLE_CLASS } from "@/components/ui/typography";

/**
 * How many lines a part of the hero wraps to on each side of the three
 * breakpoints the hero changes at: a phone, `sm` (one wide column), `lg`
 * (two columns, so the claim's column narrows again) and `xl`.
 */
type HeroLines = { base: number; sm: number; lg: number; xl: number };

const STEPS = ["sm", "lg", "xl"] as const;

// Spelled out whole so Tailwind finds every class it has to generate.
const SHOW = { sm: "sm:block", lg: "lg:block", xl: "xl:block" } as const;
const HIDE = { sm: "sm:hidden", lg: "lg:hidden", xl: "xl:hidden" } as const;

/** The classes that show one line only where the words reach it. */
function shownWhere(line: number, lines: HeroLines): string {
  let shown = line < lines.base;
  const classes = shown ? [] : ["hidden"];
  for (const step of STEPS) {
    const now = line < lines[step];
    if (now !== shown) classes.push(now ? SHOW[step] : HIDE[step]);
    shown = now;
  }
  return classes.join(" ");
}

/**
 * One box per line, each the line's own height (`h-lh` inside the type it
 * stands for) and stacked with no gap, as `SkeletonLineBars` draws them; that
 * one knows a phone and `sm` only, and this hero wraps differently again at
 * `lg` and `xl`.
 */
function LineBars({ lines, type, width }: { lines: HeroLines; type: string; width: string }) {
  const most = Math.max(lines.base, lines.sm, lines.lg, lines.xl);
  return (
    <div className={type}>
      {Array.from({ length: most }, (_, line) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: bars, not records; the line number is the only identity a placeholder line has
          key={line}
          className={`h-lh ${line === 0 ? "" : "pt-1"} ${shownWhere(line, lines)}`}
        >
          <div className={`h-full ${width} rounded bg-surface-sunken`} />
        </div>
      ))}
    </div>
  );
}

/**
 * **A feature page's hero, as bars**: what paints while the localized body
 * streams (the page's own `<Suspense>`) and while `params` resolves (the
 * segment's `loading.tsx`). Nothing in it can be tapped, on purpose: a
 * fallback with links throws a visitor's tap away when the real body swaps in
 * (FU-20260812-marketing-suspense-swap-discards-interaction).
 *
 * Shaped like the hero above the fold, at the hero's own grid and margins,
 * and sized from the twelve pages as they render (re-measured 2026-10-05,
 * after the ledes became one sentence and the price joined the demo note):
 * the title is five lines on a phone and three from `sm`, five again from
 * `lg` where the claim takes half the width, and four from `xl`; the lede
 * five, three, four and three; the demo note three lines on a phone and two
 * from `sm`; the price line two on a phone and one from `sm`. The screen is
 * the middle of the twelve drawings' heights at each width, and its three
 * notes wrap as most of the pages' do. Every page wears the same skeleton, so
 * a page that wraps a line further than these bars moves the page below it by
 * that line when the words land, and no further.
 */
export function FeaturePageSkeleton() {
  return (
    <main className="flex-1 animate-pulse">
      <section className="border-b border-border">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)] gap-12 px-6 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-16 lg:py-20">
          <div className="max-w-2xl lg:pt-2.5">
            <LineBars lines={{ base: 1, sm: 1, lg: 1, xl: 1 }} type="text-sm" width="w-44" />
            <div className="mt-5">
              <LineBars
                lines={{ base: 5, sm: 3, lg: 5, xl: 4 }}
                type={`${DISPLAY_TITLE_CLASS} sm:text-5xl`}
                width="max-w-xl"
              />
            </div>
            <div className="mt-6">
              <LineBars
                lines={{ base: 5, sm: 3, lg: 4, xl: 3 }}
                type="text-lg leading-8"
                width="max-w-xl"
              />
            </div>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-44" />
              <div className="h-12 w-full rounded-lg bg-surface-sunken sm:w-36" />
            </div>
            <div className="mt-3">
              <LineBars
                lines={{ base: 3, sm: 2, lg: 2, xl: 2 }}
                type="text-sm"
                width="w-96 max-w-full"
              />
            </div>
            <div className="mt-2">
              <LineBars
                lines={{ base: 2, sm: 1, lg: 1, xl: 1 }}
                type="text-sm"
                width="w-80 max-w-full"
              />
            </div>
          </div>
          <div>
            <div className="h-[33rem] rounded-panel border border-border bg-surface sm:h-[27rem] lg:h-[31rem] xl:h-[27rem]" />
            <div className="mt-6 space-y-3">
              <LineBars
                lines={{ base: 2, sm: 2, lg: 2, xl: 2 }}
                type="text-sm leading-6"
                width="max-w-lg"
              />
              <LineBars
                lines={{ base: 2, sm: 1, lg: 2, xl: 1 }}
                type="text-sm leading-6"
                width="max-w-lg"
              />
              <LineBars
                lines={{ base: 2, sm: 1, lg: 2, xl: 1 }}
                type="text-sm leading-6"
                width="max-w-lg"
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
