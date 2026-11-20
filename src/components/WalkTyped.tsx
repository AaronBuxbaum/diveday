import { type CSSProperties, Fragment } from "react";
import { DisclosureCaret } from "@/components/ui/DisclosureCaret";

/** One typing rate for every field in the walk: 40 ms a character is about 300 words a minute. */
export const WALK_TYPE_CHAR_MS = 40;

/**
 * Text Priya types into a drawn field. In the homepage walkthrough's first phase the characters
 * arrive left to right (`data-walk-type`, `globals.css`), starting `delay` ms into the beat; in
 * every other phase, and for a reader without the player, it is the finished text.
 */
export function WalkTyped({ text, delay = 0 }: { text: string; delay?: number }) {
  // Words with the spaces that follow them, so the spaces still wrap.
  const words = [...text.matchAll(/(\S+)(\s*)/g)].map((m) => [m[1] ?? "", m[2] ?? ""] as const);
  let place = 0;
  return (
    <span
      data-walk-type=""
      className="inline-block align-bottom"
      style={
        {
          "--type-delay": `${delay}ms`,
          "--type-ms": `${WALK_TYPE_CHAR_MS}ms`,
        } as CSSProperties
      }
    >
      {words.map(([word, space]) => {
        const start = place;
        place += word.length + space.length;
        return (
          // A word is never split across lines, so a wrapped line fills before the next begins.
          <Fragment key={start}>
            <span className="whitespace-nowrap">
              {[...word].map((char, i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: a character's place is its identity
                  key={i}
                  data-walk-char=""
                  style={{ "--i": start + i } as CSSProperties}
                >
                  {char}
                </span>
              ))}
            </span>
            {space}
          </Fragment>
        );
      })}
    </span>
  );
}

/** A drawn text box: its caption over the box, holding whatever she has typed (or nothing yet). */
export function WalkField({
  label,
  children,
  className,
}: {
  label: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="mt-1 flex min-h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm">
        {children}
      </div>
    </div>
  );
}

/**
 * The fingertip the homepage walkthrough moves (the same ring as the tap that ends a beat, never an
 * arrow): it travels to the control that holds it (which is `relative`), presses `at` ms into the
 * beat, and goes. Only the walk's first phase draws it
 * (`data-walk-cursor`, `globals.css`); the control's own change is timed by the caller to the same `at`.
 */
export function WalkCursor({ at }: { at: number }) {
  return (
    <span
      aria-hidden="true"
      data-walk-cursor=""
      style={{ "--cursor-at": `${at}ms` } as CSSProperties}
    ></span>
  );
}

/**
 * A drawn dropdown: its caption over a box with the caret at its end. In the walk's first phase
 * the placeholder is replaced by her choice `at` ms in; everywhere else the choice shows.
 */
export function WalkSelect({
  label,
  placeholder,
  value,
  at,
  className,
}: {
  label: string;
  placeholder: string;
  value: string;
  at: number;
  className?: string;
}) {
  const delay = { "--late-delay": `${at}ms` } as CSSProperties;
  return (
    <div className={className}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <div className="relative mt-1 flex min-h-9 items-center rounded-lg border border-border bg-surface px-3 text-sm">
        <span data-walk-gone="" style={delay} className="text-muted">
          {placeholder}
        </span>
        <span
          data-walk-late=""
          style={delay}
          className="absolute inset-y-0 start-3 flex items-center"
        >
          {value}
        </span>
        <span aria-hidden="true" className="ms-auto text-muted">
          <DisclosureCaret direction="down" />
        </span>
      </div>
    </div>
  );
}

/**
 * One screen giving way to the next inside the walk's first phase, `at` ms in (a tap that opens
 * another page): both are drawn in one cell, the first goes and the second arrives. The second
 * is what the tap phase and everything after show.
 */
export function WalkSwap({
  at,
  from,
  to,
}: {
  at: number;
  from: React.ReactNode;
  to: React.ReactNode;
}) {
  const delay = { "--late-delay": `${at}ms` } as CSSProperties;
  // Each screen fills the cell the taller one sets, so a short screen after a
  // tall one sits on its own ground, not above blank frame (phone polish,
  // 2026-11-20).
  return (
    <div className="grid">
      <div
        data-walk-gone=""
        style={delay}
        className="col-start-1 row-start-1 flex flex-col [&>*]:flex-1"
      >
        {from}
      </div>
      <div
        data-walk-late=""
        style={delay}
        className="col-start-1 row-start-1 flex flex-col [&>*]:flex-1"
      >
        {to}
      </div>
    </div>
  );
}

/**
 * A long page she scrolls: in the homepage walkthrough the page sits in a window of fixed height
 * and slides up over `ms` while a fingertip swipes down it, then rests at the bottom. Everywhere
 * else (a reader without the player, another page that draws this screen) it is the whole page,
 * unwindowed, so nothing here shows until the walk has marked its list (`data-walk`, `globals.css`).
 */
export function WalkScroll({ ms, children }: { ms: number; children: React.ReactNode }) {
  return (
    <div data-walk-window="">
      <div data-walk-scroll="" style={{ "--scroll-ms": `${ms}ms` } as CSSProperties}>
        {children}
      </div>
      <span
        aria-hidden="true"
        data-walk-swipe=""
        style={{ "--scroll-ms": `${ms}ms` } as CSSProperties}
      />
    </div>
  );
}
