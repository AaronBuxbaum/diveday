"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { buttonClass } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/StatusMark";

type Crew = "sal" | "keiko" | "marcus";
type Member = Crew | "you";

/**
 * How a line arrives, in ms: `wait` is the silence after the line before it,
 * `fakeOut` is dots that start and stop again without a word, and `typing` is
 * the dots that end in the line. A line with no `typing` just lands, as a quick
 * reply does. The owner never shows dots: their line lands after its silence.
 */
type Beat =
  | { from: "you"; wait: number }
  | {
      from: Crew;
      wait: number;
      fakeOut?: { typing: number; stop: number };
      typing?: number;
    };

/**
 * The scene, line by line: who sends each and how it arrives. The words come from
 * the bundle. The first line is on screen when the chat starts, so its timing is
 * unused. Tuned for the joke, not for realism: quick back-and-forth on which Tom,
 * hesitation before the dumb question, long dots that end in three words, the
 * silence before the owner, and a goodnight nobody needed to type.
 */
const SCRIPT: readonly Beat[] = [
  /* 1 Did Tom ever sign his waiver? */ { from: "keiko", wait: 0 },
  /* 2 Which Tom? */ { from: "sal", wait: 800, typing: 600 },
  /* 3 Boat Tom, not rental Tom */ { from: "keiko", wait: 150, typing: 1000 },
  /* 4 The tall one? */ { from: "marcus", wait: 700, typing: 650 },
  /* 5 They're both tall: deadpan, straight back */ { from: "sal", wait: 250, typing: 450 },
  /* 6 Is Tomasz a Tom?: he thinks better of it, then asks anyway */ {
    from: "marcus",
    wait: 300,
    fakeOut: { typing: 900, stop: 700 },
    typing: 750,
  },
  /* 7 He goes by Tom too */ { from: "keiko", wait: 200, typing: 650 },
  /* 8 The signed ones are in the binder: on the heels of her last */ {
    from: "keiko",
    wait: 0,
    typing: 900,
  },
  /* 9 Where's the binder? */ { from: "marcus", wait: 250, typing: 550 },
  /* 10 On the boat: instant */ { from: "sal", wait: 500 },
  /* 11 I thought it was in your truck */ { from: "marcus", wait: 300, typing: 1100 },
  /* 12 That's the other binder: a beat too long */ { from: "sal", wait: 1500, typing: 650 },
  /* 13 Can you go look? */ { from: "keiko", wait: 400, typing: 650 },
  /* 14 I'm in bed: a paragraph's worth of dots for three words */ {
    from: "sal",
    wait: 300,
    fakeOut: { typing: 1900, stop: 800 },
    typing: 700,
  },
  /* 15 I'll just text Tom */ { from: "marcus", wait: 600, typing: 850 },
  /* 16 Which Tom?: instant, the callback */ { from: "keiko", wait: 400 },
  /* 17 It's in DiveDay: the room goes quiet first */ { from: "you", wait: 2000 },
  /* 18 Wait, that's it? */ { from: "keiko", wait: 300, typing: 550 },
  /* 19 So rental Tom is boat Tom: working it out */ {
    from: "marcus",
    wait: 400,
    fakeOut: { typing: 700, stop: 500 },
    typing: 900,
  },
  /* 20 Good night: lands without a word of warning */ { from: "sal", wait: 1200 },
];

/** The line that carries the shop's list: "It's in DiveDay". */
const CARD_LINE = 16;

type CardState = "open" | "sent" | "signed";

/**
 * One moment of the chat: how many lines have landed, who is typing, and where
 * the list is. `ms` is how long the moment lasts before the next one; the
 * moment that waits for the visitor's tap on the nudge takes it for them when
 * it runs out.
 */
type Frame = { shown: number; typing: Crew | null; card: CardState; ms: number };

/** How long the nudge waits for the visitor before the chat sends it, in ms. */
const NUDGE_WAIT_MS = 3600;
/** From the nudge to the signature, in ms. */
const SIGN_MS = 1700;

/** The moments between one line landing and the next: silence, a false start, dots. */
function leadIn(beat: Beat, shown: number, card: CardState): Frame[] {
  const moment = (typing: Crew | null, ms: number): Frame[] =>
    ms > 0 ? [{ shown, typing, card, ms }] : [];
  if (beat.from === "you") return moment(null, beat.wait);
  return [
    ...moment(null, beat.wait),
    ...(beat.fakeOut
      ? [...moment(beat.from, beat.fakeOut.typing), ...moment(null, beat.fakeOut.stop)]
      : []),
    ...moment(beat.from, beat.typing ?? 0),
  ];
}

function buildFrames(): Frame[] {
  const frames: Frame[] = [];
  for (let shown = 1; shown < SCRIPT.length; shown += 1) {
    const card: CardState = shown > CARD_LINE ? "signed" : "open";
    if (shown === CARD_LINE + 1) {
      frames.push({ shown, typing: null, card: "open", ms: NUDGE_WAIT_MS });
      frames.push({ shown, typing: null, card: "sent", ms: SIGN_MS });
    }
    const beat = SCRIPT[shown];
    if (beat) frames.push(...leadIn(beat, shown, card));
  }
  frames.push({ shown: SCRIPT.length, typing: null, card: "signed", ms: 0 });
  return frames;
}

/** Every moment of the chat, in order; the last is the finished chat. */
const CHAT_FRAMES: readonly Frame[] = buildFrames();

/** The moment the nudge waits for a tap: the first with the list on screen. */
const NUDGE_FRAME = CHAT_FRAMES.findIndex((frame) => frame.shown === CARD_LINE + 1);

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
    typing: null,
    card: "signed",
    ms: 0,
  };

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

  const lines = labels.lines.slice(0, current.shown);

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
            <ol className="flex flex-col">
              <li className="pb-2 text-center text-xs text-muted">{labels.stamp}</li>
              {lines.map((text, index) => {
                const from: Member = SCRIPT[index]?.from ?? "you";
                const opensRun = SCRIPT[index - 1]?.from !== from;
                if (from === "you") {
                  return (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: the script is fixed and only grows
                      key={index}
                      className={`marketing-chat-in flex flex-col items-end ${opensRun ? "mt-3" : "mt-1"}`}
                    >
                      <p className="max-w-[85%] rounded-2xl rounded-ee-md bg-primary px-3 py-2 text-sm text-primary-foreground">
                        {text}
                      </p>
                      {index === CARD_LINE ? (
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
                return (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: the script is fixed and only grows
                    key={index}
                    className={`marketing-chat-in flex items-end gap-2 ${opensRun ? "mt-3" : "mt-1"}`}
                  >
                    {opensRun ? (
                      <Avatar>{labels.avatars[from]}</Avatar>
                    ) : (
                      <span className="w-7 shrink-0" />
                    )}
                    <div className="flex min-w-0 max-w-[80%] flex-col items-start">
                      {opensRun ? (
                        <p className="mb-0.5 ps-3 text-xs text-muted">{labels.names[from]}</p>
                      ) : null}
                      <p className="rounded-2xl rounded-es-md bg-surface-sunken px-3 py-2 text-sm">
                        {text}
                      </p>
                    </div>
                  </li>
                );
              })}
              {current.typing ? (
                <li key={`typing-${frame}`} className="marketing-chat-in mt-3 flex items-end gap-2">
                  <Avatar>{labels.avatars[current.typing]}</Avatar>
                  <p className="flex h-9 items-center gap-1 rounded-2xl rounded-es-md bg-surface-sunken px-3">
                    <span className="sr-only">{labels.typing[current.typing]}</span>
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        aria-hidden="true"
                        className="marketing-chat-dot size-1.5 rounded-full bg-muted"
                      />
                    ))}
                  </p>
                </li>
              ) : null}
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
