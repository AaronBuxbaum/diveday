"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { groupLabelClass } from "@/components/ui/group-label";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatusMark, StatusMarkColumn } from "@/components/ui/StatusMark";
import { FIGURE_LARGE_CLASS } from "@/components/ui/typography";
import { ROSTER_BAND, RowCaret } from "./MarketingArrivalDeskFallback";
import { AppBar, MOCK_BODY, MOCK_SECONDARY_BUTTON } from "./MarketingScreenFallbacks";

/** Every sentence the desk speaks, resolved from the bundle on the server. */
export type TryDeskLabels = {
  region: string;
  hint: string;
  appBar: string;
  /** Holds `{here}` and `{expected}`; the count is set in the figure type. */
  hereOf: string;
  toCome: string;
  blockedRemainder: string;
  allHere: string;
  /** Holds `{count}`. */
  stillToClear: string;
  /** Holds `{count}`. */
  ready: string;
  /** Holds `{count}`. */
  checkedInGroup: string;
  blocked: string;
  heldReason: string;
  samePerson: string;
  differentPerson: string;
  checkIn: string;
  checkedIn: string;
  done: string;
  restart: string;
};

const EXPECTED = 9;

const count = (template: string, n: number) => template.replace("{count}", String(n));
/** Tom and the five checked in before the page opens. */
const ALREADY_HERE = 7;

type Diver = "diego" | "priya";
type Stage = "held" | "ready" | "in";
const START: Record<Diver, Stage> = { diego: "held", priya: "ready" };

/**
 * **The arrival desk, tappable.** The same screen `ArrivalDeskFallback` draws, with its three
 * taps working on the page: the held seat's "Same person", then "Check in" on each of the two
 * who are ready, until 9 of 9 are here. The look is the real desk's (the same parts and the
 * same bundle words); the behavior is a script held in the browser. Nothing is sent, saved or
 * read, and "Start over" puts the list back. The first paint is the drawing's: server-rendered
 * with the starting list, so a reader without a script sees the same desk.
 *
 * @mirrors src/app/shop/[shopSlug]/trips/[id]/_arrivals/arrival-desk.tsx
 * @mirrors src/app/shop/[shopSlug]/trips/[id]/_arrivals/CounterInstrument.tsx
 * @mirrors src/app/shop/[shopSlug]/trips/[id]/_arrivals/ArrivalTap.tsx
 * @mirrors src/app/shop/[shopSlug]/trips/[id]/_components/RosterSection.tsx
 * @mirrors src/app/shop/[shopSlug]/trips/[id]/_components/RosterGroupBand.tsx
 * @mirrors src/components/IdentityCheck.tsx
 */
export function MarketingTryDesk({ labels }: { labels: TryDeskLabels }) {
  const [stage, setStage] = useState<Record<Diver, Stage>>(START);
  const [touched, setTouched] = useState(false);

  const set = (who: Diver, next: Stage) => {
    setTouched(true);
    setStage((current) => ({ ...current, [who]: next }));
  };
  const names: Record<Diver | "tom", string> = {
    // i18n-exempt: sample diver names used only in marketing mockups
    diego: "Diego Alvarez",
    // i18n-exempt: sample diver names used only in marketing mockups
    priya: "Priya Sharma",
    // i18n-exempt: sample diver names used only in marketing mockups
    tom: "Tom Okafor",
  };
  const here = ALREADY_HERE + (stage.diego === "in" ? 1 : 0) + (stage.priya === "in" ? 1 : 0);
  const allHere = here === EXPECTED;
  const held = stage.diego === "held";
  const readyDivers = (["diego", "priya"] as const).filter((who) => stage[who] === "ready");
  const inDivers = (["diego", "priya"] as const).filter((who) => stage[who] === "in");
  const [hereBefore = "", hereAfter = ""] = labels.hereOf
    .replace("{expected}", String(EXPECTED))
    .split("{here}");
  const remainder = allHere
    ? labels.allHere
    : held
      ? stage.priya === "in"
        ? labels.blockedRemainder
        : `${labels.toCome} · ${labels.blockedRemainder}`
      : labels.toCome;

  return (
    <div>
      <p className="mb-3 text-sm text-muted">{labels.hint}</p>
      {/* A `<figure>`, not a `<section>`: the home spec counts the page's sections by position. */}
      <figure
        aria-label={labels.region}
        className="min-h-[502px] m-0 overflow-hidden rounded-3xl border border-border bg-background text-start lg:min-h-[486px]"
      >
        <div className="bg-background">
          <AppBar label={labels.appBar} />
          <div className={MOCK_BODY}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm text-muted tabular-nums" aria-live="polite">
                {hereBefore}
                <span className={`${FIGURE_LARGE_CLASS} text-foreground`}>{here}</span>
                {hereAfter}
              </p>
              <p className="text-xs text-muted">{remainder}</p>
            </div>
            <ProgressBar
              aria-hidden="true"
              className="mt-2 h-[5px]"
              segments={[
                { key: "here", fraction: here / EXPECTED, className: "bg-success/70" },
                ...(held
                  ? [{ key: "blocked", fraction: 1 / EXPECTED, className: "bg-danger/60" }]
                  : []),
              ]}
            />
            <div className="mt-4 overflow-hidden rounded-inset border border-border bg-surface">
              {held ? (
                <>
                  <div className={ROSTER_BAND}>
                    <p className={groupLabelClass()}>{count(labels.stillToClear, 1)}</p>
                  </div>
                  <div className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 text-sm font-semibold">{names.diego}</p>
                      <Badge tone="danger" size="sm" toneMark={false}>
                        {labels.blocked}
                      </Badge>
                      <RowCaret />
                    </div>
                    <p className="flex items-baseline gap-2 text-xs text-danger">
                      <StatusMarkColumn variant="danger" />
                      <span>{labels.heldReason}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-try-tap=""
                        onClick={() => set("diego", "ready")}
                        className={`px-3 ${MOCK_SECONDARY_BUTTON} cursor-pointer ${touched ? "" : "ring-2 ring-primary/40"}`}
                      >
                        {labels.samePerson}
                      </button>
                      <button type="button" disabled className={`px-3 ${MOCK_SECONDARY_BUTTON}`}>
                        {labels.differentPerson}
                      </button>
                    </div>
                  </div>
                </>
              ) : null}
              {readyDivers.length > 0 ? (
                <>
                  <div className={ROSTER_BAND}>
                    <p className={groupLabelClass()}>{count(labels.ready, readyDivers.length)}</p>
                  </div>
                  {readyDivers.map((who) => (
                    <div key={who} className="flex items-center gap-2 px-4 py-1.5">
                      <p className="min-w-0 flex-1 text-sm font-semibold">{names[who]}</p>
                      <button
                        type="button"
                        data-try-tap=""
                        onClick={() => set(who, "in")}
                        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs font-semibold whitespace-nowrap text-primary"
                      >
                        <span
                          aria-hidden="true"
                          className="size-5 shrink-0 rounded-full border-2 border-current"
                        />
                        {labels.checkIn}
                      </button>
                      <RowCaret />
                    </div>
                  ))}
                </>
              ) : null}
              <div className={ROSTER_BAND}>
                <p className={groupLabelClass()}>{count(labels.checkedInGroup, here)}</p>
              </div>
              {[...inDivers, "tom" as const].map((who) => (
                <div key={who} className="flex items-center gap-2 px-4 py-1.5">
                  <p className="min-w-0 flex-1 text-sm font-semibold">{names[who]}</p>
                  <span className="inline-flex min-h-11 items-center gap-2 px-2 text-xs font-semibold whitespace-nowrap text-success">
                    <StatusMark variant="success" size="md" />
                    {labels.checkedIn}
                  </span>
                  <RowCaret />
                </div>
              ))}
            </div>
          </div>
        </div>
      </figure>
      <div className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium">{allHere ? labels.done : ""}</p>
        {touched ? (
          <button
            type="button"
            onClick={() => {
              setStage(START);
              setTouched(false);
            }}
            className="cursor-pointer text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {labels.restart}
          </button>
        ) : null}
      </div>
    </div>
  );
}
