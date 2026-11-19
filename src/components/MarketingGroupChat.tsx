"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { buttonClass } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/StatusMark";

type Crew = "sal" | "keiko" | "marcus";
type Member = Crew | "you";

/**
 * How a line arrives, in ms. `after` is how long after the line before it this
 * one lands. `typing` is the dots that end in the line, and `fakeOut` is dots
 * that started earlier and stopped `stop` ms before those (or before the line,
 * when it has no `typing`). Dots longer than `after` began before the previous
 * line landed, which is how two or three people end up typing at once and land
 * in a different order than they started. The owner never shows dots.
 */
type Beat =
  | { from: "you"; after: number }
  | {
      from: Crew;
      after: number;
      typing?: number;
      fakeOut?: { typing: number; stop: number };
    };

/**
 * The scene, line by line: who sends each and how it arrives. The words come from
 * the bundle. The first line is on screen when the chat starts, so its timing is
 * unused. Paced to be read, and tuned for the joke: Keiko and Marcus both
 * answering "Which Tom?", dots that stop before "Is Tomasz a Tom?", long dots
 * that end in three words, Keiko's "Which Tom?" overtaking Marcus, the silence
 * before the owner, and everyone reacting to the list at once.
 */
const SCRIPT: readonly Beat[] = [
  /* 1 Did Tom ever sign his waiver? */ { from: "keiko", after: 0 },
  /* 2 Which Tom? */ { from: "sal", after: 2600, typing: 1300 },
  /* 3 Boat Tom, not rental Tom: Keiko and Marcus both start answering */ {
    from: "keiko",
    after: 2400,
    typing: 2000,
  },
  /* 4 The tall one?: he started just after her */ {
    from: "marcus",
    after: 1000,
    typing: 2800,
  },
  /* 5 They're both tall: deadpan, straight back */ { from: "sal", after: 1300, typing: 900 },
  /* 6 Is Tomasz a Tom?: he thinks better of it, then asks anyway */ {
    from: "marcus",
    after: 4800,
    fakeOut: { typing: 1800, stop: 1200 },
    typing: 1300,
  },
  /* 7 He goes by Tom too */ { from: "keiko", after: 1700, typing: 1200 },
  /* 8 The signed ones are in the binder: on the heels of her last */ {
    from: "keiko",
    after: 1900,
    typing: 1900,
  },
  /* 9 Where's the binder? */ { from: "marcus", after: 2400, typing: 1400 },
  /* 10 On the boat: instant */ { from: "sal", after: 900 },
  /* 11 I thought it was in your truck */ { from: "marcus", after: 2400, typing: 1700 },
  /* 12 That's the other binder: a beat too long */ { from: "sal", after: 3600, typing: 1100 },
  /* 13 Can you go look? */ { from: "keiko", after: 2200, typing: 1300 },
  /* 14 I'm in bed: a paragraph's worth of dots for three words */ {
    from: "sal",
    after: 6500,
    fakeOut: { typing: 3000, stop: 1500 },
    typing: 1400,
  },
  /* 15 I'll just text Tom: Marcus and Keiko both typing */ {
    from: "marcus",
    after: 2600,
    typing: 2000,
  },
  /* 16 Which Tom?: hers was already on its way */ { from: "keiko", after: 700, typing: 2200 },
  /* 17 It's in DiveDay: the room goes quiet first */ { from: "you", after: 3200 },
  /* 18 Wait, that's it?: everyone types at once, Keiko lands first */ {
    from: "keiko",
    after: 1800,
    typing: 1100,
  },
  /* 19 So rental Tom is boat Tom: Marcus started first */ {
    from: "marcus",
    after: 1800,
    typing: 3300,
  },
  /* 20 Good night: Sal's dots gave up long ago; it lands without a word of warning */ {
    from: "sal",
    after: 2600,
    fakeOut: { typing: 1400, stop: 3600 },
  },
];

/** The line that carries the shop's list: "It's in DiveDay". */
const CARD_LINE = 16;

type CardState = "open" | "sent" | "signed";

/** Someone's dots, and the line (by index) they turn into. */
type Typist = { from: Crew; line: number };

/**
 * One moment of the chat: how many lines have landed, whose dots are showing in
 * the order they started, and where the list is. `ms` is how long the moment
 * lasts before the next one; the moment that waits for the visitor's tap on the
 * nudge takes it for them when it runs out.
 */
type Frame = { shown: number; typing: readonly Typist[]; card: CardState; ms: number };

/** How long the nudge waits for the visitor before the chat sends it, in ms. */
const NUDGE_WAIT_MS = 3600;
/** From the nudge to the signature, in ms. */
const SIGN_MS = 1700;

/**
 * The moments while lines `from` up to `to` (indexes, `to` excluded) land, cut
 * wherever a line lands or someone's dots start or stop. Dots that would start
 * before the first of these lines' clock are clipped to it.
 */
function play(from: number, to: number, card: CardState): Frame[] {
  const lands: number[] = [];
  const dots: { start: number; end: number; who: Typist }[] = [];
  let clock = 0;
  for (let line = from; line < to; line += 1) {
    const beat = SCRIPT[line];
    if (!beat) continue;
    clock += beat.after;
    lands.push(clock);
    if (beat.from === "you") continue;
    const who = { from: beat.from, line };
    const typing = beat.typing ?? 0;
    if (typing > 0) dots.push({ start: clock - typing, end: clock, who });
    if (beat.fakeOut) {
      const end = clock - typing - beat.fakeOut.stop;
      dots.push({ start: end - beat.fakeOut.typing, end, who });
    }
  }
  const cuts = [...new Set([0, ...lands, ...dots.flatMap((dot) => [dot.start, dot.end])])]
    .filter((at) => at >= 0 && at <= clock)
    .sort((a, b) => a - b);
  const frames: Frame[] = [];
  for (const [index, at] of cuts.entries()) {
    const next = cuts[index + 1];
    if (next === undefined) break;
    const typing: Typist[] = [];
    for (const dot of dots
      .filter((dot) => dot.start <= at && at < dot.end)
      .sort((a, b) => a.start - b.start)) {
      if (!typing.some((who) => who.from === dot.who.from)) typing.push(dot.who);
    }
    const shown = from + lands.filter((land) => land <= at).length;
    frames.push({ shown, typing, card, ms: next - at });
  }
  return frames;
}

/** Every moment of the chat, in order; the last is the finished chat. */
const CHAT_FRAMES: readonly Frame[] = [
  ...play(1, CARD_LINE + 1, "open"),
  { shown: CARD_LINE + 1, typing: [], card: "open", ms: NUDGE_WAIT_MS },
  { shown: CARD_LINE + 1, typing: [], card: "sent", ms: SIGN_MS },
  ...play(CARD_LINE + 1, SCRIPT.length, "signed"),
  { shown: SCRIPT.length, typing: [], card: "signed", ms: 0 },
];

/** The moment the nudge waits for a tap: the first with the list on screen. */
const NUDGE_FRAME = CHAT_FRAMES.findIndex((frame) => frame.shown === CARD_LINE + 1);

/**
 * How far a row is drawn from where it is laid out, mid-slide: the vertical part
 * of its transform, so a slide that is interrupted carries on from where it is.
 */
function drawnOffset(row: HTMLElement) {
  const matrix = getComputedStyle(row).transform.match(/^matrix(3d)?\((.+)\)$/);
  if (!matrix?.[2]) return 0;
  const values = matrix[2].split(",").map(Number);
  return (matrix[1] ? values[13] : values[5]) ?? 0;
}

/** A row's slide to its new place: the length of a line unfolding, on the house curve. */
const SLIDE = { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" } as const;

export type GroupChatLabels = {
  group: string;
  members: string;
  stamp: string;
  names: Record<Crew, string>;
  typing: Record<Crew, string>;
  /** Each crew member's face, drawn by the caller at the avatar's size. */
  avatars: Record<Crew, ReactNode>;
  lines: readonly string[];
  card: {
    title: string;
    readyBefore: string;
    readyAfter: string;
    needsYou: string;
    diver: string;
    /** The diver's profile picture. */
    avatar: ReactNode;
    unsigned: string;
    nudge: string;
    sent: string;
    signed: string;
  };
  composer: string;
  replay: string;
  note: string;
};

function Avatar({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className="block size-7 shrink-0 overflow-hidden rounded-full bg-surface-sunken"
    >
      {children}
    </span>
  );
}

/** The shop's own list, sent into the chat: one departure, its count, and the one diver left. */
function ListCard({
  labels,
  state,
  waiting,
  onNudge,
}: {
  labels: GroupChatLabels["card"];
  state: CardState;
  waiting: boolean;
  onNudge: () => void;
}) {
  const signed = state === "signed";
  return (
    <div className="mt-1 w-full rounded-2xl border border-border bg-surface p-3 text-start">
      <p className="text-sm font-semibold">{labels.title}</p>
      <p
        key={signed ? "after" : "before"}
        className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
          signed
            ? "marketing-chat-flash bg-success-tint text-success-strong"
            : "bg-surface-sunken text-muted"
        }`}
      >
        {signed ? labels.readyAfter : labels.readyBefore}
      </p>
      <p className="mt-3 text-xs font-semibold text-muted">{labels.needsYou}</p>
      <div className="mt-1 flex min-h-11 items-center gap-2 border-t border-border pt-2">
        <Avatar>{labels.avatar}</Avatar>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${signed ? "text-muted line-through" : ""}`}>
            {labels.diver}
          </p>
          <p className="flex items-center gap-1 text-xs text-muted">
            {signed ? <StatusMark variant="success" size="sm" /> : null}
            {signed ? labels.signed : labels.unsigned}
          </p>
        </div>
        {state === "open" ? (
          <button
            type="button"
            data-try-tap
            onClick={onNudge}
            className={`${buttonClass({ variant: "secondary", size: "sm" })} shrink-0 ${
              waiting ? "marketing-chat-nudge" : ""
            }`}
          >
            {labels.nudge}
          </button>
        ) : state === "sent" ? (
          <span className="marketing-chat-in shrink-0 text-xs font-semibold text-primary">
            {labels.sent}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The homepage hero's group chat: a dive shop's crew the night before a boat,
 * asking each other who signed, until the owner sends the list and nudges the
 * one diver left.
 *
 * The server sends the finished chat, so a reader without script, a reader who
 * asked for reduced motion and the camera all see the end: the list at nine of
 * nine. A reader with motion sees it rewound before first paint and played
 * once it is on screen, each line on its own beat (`SCRIPT`).
 */
export function MarketingGroupChat({ labels }: { labels: GroupChatLabels }) {
  const last = CHAT_FRAMES.length - 1;
  // `null` is the finished chat, which is what the server sends.
  const [at, setAt] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const frame = at ?? last;
  const current = CHAT_FRAMES[frame] ?? {
    shown: SCRIPT.length,
    typing: [],
    card: "signed",
    ms: 0,
  };
  const listRef = useRef<HTMLOListElement>(null);
  /** Where each row was laid out at the last moment, from the top of the box. */
  const placed = useRef(new Map<string, number>());
  const placedAt = useRef<number | null>(null);

  // Rewind before paint, unless motion is unwelcome.
  useLayoutEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setAt(0);
    setReady(true);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const watcher = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? false),
      { threshold: 0.4 },
    );
    watcher.observe(root);
    return () => watcher.disconnect();
  }, []);

  useEffect(() => {
    if (!ready || !onScreen || frame >= last) return;
    const timer = window.setTimeout(() => setAt(frame + 1), current.ms);
    return () => window.clearTimeout(timer);
  }, [ready, onScreen, frame, last, current.ms]);

  // Moving on a moment, every row that changed place slides there from where it was drawn: a
  // landing line pushes the chat up rather than jumping it, and lines overtaking dots swap smoothly.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const forward = placedAt.current !== null && frame > placedAt.current;
    placedAt.current = frame;
    const top = list.parentElement?.getBoundingClientRect().top ?? 0;
    const next = new Map<string, number>();
    for (const row of list.querySelectorAll<HTMLElement>("[data-chat-row]")) {
      const key = row.dataset.chatRow ?? "";
      const drawn = drawnOffset(row);
      const laid = row.getBoundingClientRect().top - drawn - top;
      next.set(key, laid);
      const was = placed.current.get(key);
      if (!forward || was === undefined || typeof row.animate !== "function") continue;
      const from = was - laid + drawn;
      if (Math.abs(from) < 0.5) continue;
      for (const slide of row.getAnimations()) if (slide.id === "chat-slide") slide.cancel();
      const slide = row.animate(
        [{ transform: `translateY(${from}px)` }, { transform: "translateY(0)" }],
        SLIDE,
      );
      slide.id = "chat-slide";
    }
    placed.current = next;
  }, [frame]);

  const rows: { line: number; from: Member; text: string | null }[] = [
    ...labels.lines
      .slice(0, current.shown)
      .map((text, line) => ({ line, from: SCRIPT[line]?.from ?? "you", text })),
    ...current.typing.map(({ from, line }) => ({ line, from, text: null })),
  ];

  return (
    <div
      ref={rootRef}
      data-chat-frame={frame}
      data-chat-ms={current.ms}
      data-chat-end={frame === last ? "" : undefined}
    >
      <div className="marketing-roll-call-frame mx-auto w-full max-w-[22.5rem] rounded-[2.5rem] border-[9px] border-device-frame bg-device-frame p-1.5">
        <div className="mx-auto mb-1.5 h-1.5 w-20 rounded-full bg-muted/50" />
        <div className="overflow-hidden rounded-[calc(2.5rem-9px-var(--spacing)*1.5)] bg-surface text-start">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <DiveDayIcon name="chevron-left" className="size-5 shrink-0 text-primary" />
            <span aria-hidden="true" className="flex shrink-0 -space-x-2">
              {(["sal", "keiko", "marcus"] as const).map((member) => (
                <span key={member} className="rounded-full ring-2 ring-surface">
                  <Avatar>{labels.avatars[member]}</Avatar>
                </span>
              ))}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{labels.group}</p>
              <p className="truncate text-xs text-muted">{labels.members}</p>
            </div>
          </div>

          {/* Reversed, so the newest line is what the box rests on with or without script. */}
          <div className="marketing-chat-scroll flex h-[27rem] flex-col-reverse overflow-y-auto px-3 py-3">
            <ol ref={listRef} className="flex flex-col">
              <li className="pb-2 text-center text-xs text-muted">{labels.stamp}</li>
              {rows.map((row, index) => {
                const opensRun = rows[index - 1]?.from !== row.from;
                const spacing = opensRun ? "mt-3" : "mt-1";
                if (row.from === "you") {
                  return (
                    <li
                      key={`line-${row.line}`}
                      data-chat-row={row.line}
                      className={`marketing-chat-in flex flex-col items-end ${spacing}`}
                    >
                      <p className="max-w-[85%] rounded-2xl rounded-ee-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                        {row.text}
                      </p>
                      {row.line === CARD_LINE ? (
                        <ListCard
                          labels={labels.card}
                          state={current.card}
                          waiting={frame === NUDGE_FRAME}
                          onNudge={() => setAt(NUDGE_FRAME + 1)}
                        />
                      ) : null}
                    </li>
                  );
                }
                // A line's dots and the line share one row, so the line lands where its dots were.
                return (
                  <li
                    key={`line-${row.line}`}
                    data-chat-row={row.line}
                    className={`marketing-chat-in flex items-end gap-2 ${spacing}`}
                  >
                    {opensRun ? (
                      <Avatar>{labels.avatars[row.from]}</Avatar>
                    ) : (
                      <span className="w-7 shrink-0" />
                    )}
                    <div className="flex min-w-0 max-w-[80%] flex-col items-start">
                      {opensRun ? (
                        <p className="mb-0.5 ps-3 text-xs text-muted">{labels.names[row.from]}</p>
                      ) : null}
                      {row.text === null ? (
                        <p
                          key="dots"
                          className="flex h-9 items-center gap-1 rounded-2xl rounded-es-md bg-surface-sunken px-3"
                        >
                          <span className="sr-only">{labels.typing[row.from]}</span>
                          {[0, 1, 2].map((dot) => (
                            <span
                              key={dot}
                              aria-hidden="true"
                              className="marketing-chat-dot size-1.5 rounded-full bg-muted"
                            />
                          ))}
                        </p>
                      ) : (
                        <p
                          key="text"
                          className="rounded-2xl rounded-es-md bg-surface-sunken px-3 py-2 text-sm"
                        >
                          <span className="marketing-chat-reveal">{row.text}</span>
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <div aria-hidden="true" className="flex items-center gap-2 border-t border-border p-2.5">
            <span className="h-9 flex-1 content-center rounded-full border border-border px-3.5 text-sm text-muted">
              {labels.composer}
            </span>
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <DiveDayIcon name="arrow-up" className="size-4" />
            </span>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-4 max-w-[22.5rem] text-center">
        <p className="text-sm text-muted">{labels.note}</p>
        {/* Kept in the layout from the start, so the page does not move when the chat ends. */}
        <button
          type="button"
          data-try-tap
          onClick={() => setAt(0)}
          className={`${buttonClass({ variant: "link", size: "sm" })} ${
            ready && frame === last ? "" : "invisible"
          }`}
        >
          {labels.replay}
        </button>
      </div>
    </div>
  );
}
