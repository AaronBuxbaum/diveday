"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DiveDayIcon } from "@/components/DiveDayIcon";
import { buttonClass } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/StatusMark";

type Member = "dana" | "rob" | "mia" | "you";

/** Who sends each line, in order. The words come from the bundle; the cast and the order are the scene. */
const SENDERS = [
  "dana",
  "rob",
  "dana",
  "mia",
  "mia",
  "rob",
  "you",
  "dana",
  "rob",
  "mia",
] as const satisfies readonly Member[];

/** The line that carries the shop's list: "It's on the list". */
const CARD_LINE = 6;

type CardState = "open" | "sent" | "signed";

/**
 * One moment of the chat: how many lines have landed, who is typing, and where
 * the list is. `ms` is how long the moment lasts before the next one; the
 * moment that waits for the visitor's tap on the nudge takes it for them when
 * it runs out.
 */
type Frame = { shown: number; typing: Member | null; card: CardState; ms: number };

const FRAMES: readonly Frame[] = [
  { shown: 1, typing: "rob", card: "open", ms: 1300 },
  { shown: 2, typing: "dana", card: "open", ms: 1500 },
  { shown: 3, typing: "mia", card: "open", ms: 1400 },
  { shown: 4, typing: "mia", card: "open", ms: 1300 },
  { shown: 5, typing: "rob", card: "open", ms: 1900 },
  { shown: 6, typing: null, card: "open", ms: 1600 },
  { shown: 7, typing: null, card: "open", ms: 3600 },
  { shown: 7, typing: null, card: "sent", ms: 1700 },
  { shown: 7, typing: "dana", card: "signed", ms: 1700 },
  { shown: 8, typing: "rob", card: "signed", ms: 1300 },
  { shown: 9, typing: "mia", card: "signed", ms: 1500 },
  { shown: 10, typing: null, card: "signed", ms: 0 },
];

const LAST = FRAMES.length - 1;
/** The moment the nudge waits for a tap. */
const NUDGE_FRAME = FRAMES.findIndex((frame) => frame.shown > CARD_LINE);

export type GroupChatLabels = {
  region: string;
  group: string;
  members: string;
  stamp: string;
  names: Record<Exclude<Member, "you">, string>;
  typing: Record<Exclude<Member, "you">, string>;
  lines: readonly string[];
  card: {
    title: string;
    readyBefore: string;
    readyAfter: string;
    needsYou: string;
    diver: string;
    unsigned: string;
    nudge: string;
    sent: string;
    signed: string;
  };
  composer: string;
  replay: string;
  note: string;
};

const AVATAR_TONE: Record<Exclude<Member, "you">, string> = {
  dana: "bg-primary-tint text-primary",
  rob: "bg-accent-tint text-accent-deep",
  mia: "bg-shallows text-foreground",
};

function Avatar({ member, name }: { member: Exclude<Member, "you">; name: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${AVATAR_TONE[member]}`}
    >
      {name.slice(0, 1)}
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
        <StatusMark variant={signed ? "success" : "pending"} size="md" />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${signed ? "text-muted line-through" : ""}`}>
            {labels.diver}
          </p>
          <p className="text-xs text-muted">{signed ? labels.signed : labels.unsigned}</p>
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
 * once it is on screen, each line landing after its sender's typing dots.
 */
export function MarketingGroupChat({ labels }: { labels: GroupChatLabels }) {
  const [frame, setFrame] = useState(LAST);
  const [ready, setReady] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = FRAMES[frame] ?? FRAMES[LAST];

  // Rewind before paint, unless motion is unwelcome.
  useLayoutEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) setFrame(0);
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
    if (!ready || !onScreen || frame >= LAST) return;
    const timer = window.setTimeout(() => setFrame((at) => Math.min(LAST, at + 1)), current.ms);
    return () => window.clearTimeout(timer);
  }, [ready, onScreen, frame, current.ms]);

  const lines = labels.lines.slice(0, current.shown);

  return (
    <div ref={rootRef} data-chat-frame={frame} data-chat-end={frame === LAST ? "" : undefined}>
      <div className="marketing-roll-call-frame mx-auto w-full max-w-[22.5rem] rounded-[2.5rem] border-[9px] border-device-frame bg-device-frame p-1.5">
        <div className="mx-auto mb-1.5 h-1.5 w-20 rounded-full bg-muted/50" />
        <div className="overflow-hidden rounded-[calc(2.5rem-9px-var(--spacing)*1.5)] bg-surface text-start">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <DiveDayIcon name="chevron-left" className="size-5 shrink-0 text-primary" />
            <span aria-hidden="true" className="flex shrink-0 -space-x-2">
              {(["dana", "rob", "mia"] as const).map((member) => (
                <span key={member} className="rounded-full ring-2 ring-surface">
                  <Avatar member={member} name={labels.names[member]} />
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
                const from: Member = SENDERS[index] ?? "you";
                const opensRun = SENDERS[index - 1] !== from;
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
                          onNudge={() => setFrame(NUDGE_FRAME + 1)}
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
                      <Avatar member={from} name={labels.names[from]} />
                    ) : (
                      <span className="w-7 shrink-0" />
                    )}
                    <div className="min-w-0 max-w-[80%]">
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
              {current.typing && current.typing !== "you" ? (
                <li
                  key={`typing-${current.shown}`}
                  className="marketing-chat-in mt-3 flex items-end gap-2"
                >
                  <Avatar member={current.typing} name={labels.names[current.typing]} />
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
          onClick={() => setFrame(0)}
          className={`${buttonClass({ variant: "link", size: "sm" })} ${
            ready && frame === LAST ? "" : "invisible"
          }`}
        >
          {labels.replay}
        </button>
      </div>
    </div>
  );
}
