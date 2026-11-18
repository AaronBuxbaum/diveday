"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  type BoatDeskLabels,
  type DeskState,
  MarketingBoatDesk,
} from "@/components/MarketingBoatDesk";
import {
  type BoatStageLabels,
  DIVER_INDICES,
  type DiverIndex,
  MarketingBoatStage,
} from "@/components/MarketingBoatStage";
import { buttonClass } from "@/components/ui/button";
import { StatusMark } from "@/components/ui/StatusMark";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";

type BoatLabels = BoatStageLabels & {
  title: string;
  desk: BoatDeskLabels;
  dockCheckpoint: string;
  dockChoose: string;
  dockAboard: string;
  dockPreviously: string;
  depart: string;
  open: string;
  closed: string;
  counts: [string, string, string];
  choose: string;
  aboard: string;
  restart: string;
  record: string;
  checkpoint: string;
  previously: string;
};

export function MarketingBoatRollCall({
  labels,
  deskPoster,
  dockPoster,
  reefPoster,
}: {
  labels: BoatLabels;
  deskPoster: ReactNode;
  dockPoster: ReactNode;
  reefPoster: ReactNode;
}) {
  const descriptionId = useId();
  const [selected, setSelected] = useState<DiverIndex | null>(null);
  const [atReef, setAtReef] = useState(false);
  const [deskState, setDeskState] = useState<DeskState>("waiting");
  const [hadHold, setHadHold] = useState(false);
  const isDesk = deskState !== "matched";
  const phase = isDesk ? "desk" : atReef ? "reef" : "dock";
  const [dockOrder, setDockOrder] = useState<DiverIndex[]>([]);
  const [reefOrder, setReefOrder] = useState<DiverIndex[]>([]);
  const checkpointRef = useRef<HTMLParagraphElement>(null);
  const previousPhase = useRef(phase);
  useEffect(() => {
    if (previousPhase.current !== phase) checkpointRef.current?.focus();
    previousPhase.current = phase;
  }, [phase]);
  const checked: [boolean, boolean] = atReef
    ? [reefOrder.includes(0), reefOrder.includes(1)]
    : [dockOrder.includes(0), true];
  const complete = checked[0] && checked[1];
  const recorded = atReef ? labels.aboard : labels.dockAboard;
  const diver = selected === null ? null : labels.divers[selected];

  function openCard() {
    setSelected(0);
    setDeskState("review");
  }

  function matchCard() {
    setSelected(null);
    setDeskState("matched");
  }

  function holdCard() {
    setSelected(null);
    setHadHold(true);
    setDeskState("held");
  }

  function confirm(index: DiverIndex) {
    if (isDesk) return;
    if (!atReef && index === 1) return;
    const save = atReef ? setReefOrder : setDockOrder;
    save((order) => (order.includes(index) ? order : [...order, index]));
  }

  function depart() {
    if (isDesk || !dockOrder.includes(0)) return;
    setSelected(null);
    setAtReef(true);
  }

  function restart() {
    setSelected(null);
    setDeskState("waiting");
    setHadHold(false);
    setDockOrder([]);
    setReefOrder([]);
    setAtReef(false);
  }

  return (
    <>
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 sm:px-5">
        <p className={`${ITEM_TITLE_CLASS} text-balance`}>{labels.title}</p>
        <p ref={checkpointRef} tabIndex={-1} className="text-end text-sm text-pretty text-muted">
          {isDesk ? labels.desk.checkpoint : atReef ? labels.checkpoint : labels.dockCheckpoint}
        </p>
      </div>
      <MarketingBoatStage
        labels={labels}
        atReef={atReef}
        isDesk={isDesk}
        deskPin={labels.desk.pin}
        poster={isDesk ? deskPoster : atReef ? reefPoster : dockPoster}
        checked={checked}
        selected={selected}
        onSelect={isDesk ? openCard : setSelected}
        onOverview={() => setSelected(null)}
      />
      <figcaption className="px-4 py-4 sm:px-5">
        {deskState !== "matched" ? (
          <MarketingBoatDesk
            state={deskState}
            labels={labels.desk}
            name={labels.divers[0].name}
            tomName={labels.divers[1].name}
            open={openCard}
            match={matchCard}
            hold={holdCard}
          />
        ) : (
          <>
            <div
              role="status"
              aria-atomic="true"
              className="flex min-h-7 flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
            >
              <span className={ITEM_TITLE_CLASS}>{complete ? labels.closed : labels.open}</span>
              <span className="text-sm font-medium text-muted tabular-nums">
                {labels.counts[Number(checked[0]) + Number(checked[1])]}
              </span>
            </div>
            {!complete ? (
              <p className="mt-2 text-sm text-muted">
                {atReef ? labels.choose : labels.dockChoose}
              </p>
            ) : null}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {DIVER_INDICES.map((index) => {
                const person = labels.divers[index];
                return (
                  <button
                    key={person.name}
                    type="button"
                    data-try-tap=""
                    aria-pressed={selected === index}
                    aria-label={person.select}
                    aria-describedby={checked[index] ? `${descriptionId}-${index}` : undefined}
                    onClick={() => setSelected(index)}
                    className={buttonClass({
                      variant: "secondary",
                      size: "sm",
                      className:
                        "w-full aria-pressed:ring-2 aria-pressed:ring-primary aria-pressed:ring-inset",
                    })}
                  >
                    <StatusMark
                      variant={checked[index] ? "success" : "pending"}
                      className={checked[index] ? "text-success" : "text-muted"}
                    />
                    <span>{person.name}</span>
                    {checked[index] ? (
                      <span className="sr-only" id={`${descriptionId}-${index}`}>
                        {recorded}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            {selected !== null && diver ? (
              <div className="mt-3 border-t border-border pt-3">
                <p className="text-sm font-semibold">{diver.place}</p>
                <p className="mt-1 text-sm leading-5 text-muted">{diver.gear}</p>
                <button
                  type="button"
                  data-try-tap=""
                  aria-disabled={checked[selected]}
                  onClick={() => {
                    if (!checked[selected]) confirm(selected);
                  }}
                  className={buttonClass({
                    variant: checked[selected] ? "bare" : "primary",
                    size: "sm",
                    className: "mt-2",
                  })}
                >
                  {checked[selected] ? (
                    <StatusMark variant="success" className="text-success" />
                  ) : null}
                  {checked[selected] ? recorded : atReef ? diver.confirm : diver.dockConfirm}
                </button>
              </div>
            ) : null}
            {atReef && complete ? (
              <details className="mt-3 border-t border-border">
                <summary className="min-h-11 cursor-pointer content-center py-2 text-sm font-semibold text-primary">
                  {labels.record}
                </summary>
                <div className="divide-y divide-border rounded-inset bg-surface-sunken px-3 text-sm">
                  <section
                    data-boat-checkpoint="desk"
                    aria-label={labels.desk.checkpoint}
                    className="py-2"
                  >
                    <p className="font-semibold">{labels.desk.checkpoint}</p>
                    <ul className="mt-2 divide-y divide-border">
                      <li className="py-1">
                        {labels.divers[1].name} · {labels.desk.previouslyChecked}
                      </li>
                      <li className="py-1">
                        {labels.divers[0].name} · {labels.desk.verified}
                      </li>
                    </ul>
                    {hadHold ? <p className="text-muted">{labels.desk.corrected}</p> : null}
                  </section>
                  {[
                    {
                      phase: "dock",
                      checkpoint: labels.dockCheckpoint,
                      previously: labels.dockPreviously,
                      marks: dockOrder,
                    },
                    {
                      phase: "reef",
                      checkpoint: labels.checkpoint,
                      previously: labels.previously,
                      marks: reefOrder,
                    },
                  ].map(({ phase, checkpoint, previously, marks }) => (
                    <section
                      key={phase}
                      data-boat-checkpoint={phase}
                      aria-label={checkpoint}
                      className="py-2"
                    >
                      <p className="font-semibold">{checkpoint}</p>
                      <p className="mt-1 text-muted">{previously}</p>
                      <ol className="mt-2 divide-y divide-border">
                        {marks.map((index) => (
                          <li key={index} className="flex items-center gap-2 py-1">
                            <StatusMark variant="success" className="text-success" />
                            {labels.divers[index].name}
                          </li>
                        ))}
                      </ol>
                    </section>
                  ))}
                </div>
              </details>
            ) : null}
            {complete ? (
              <button
                type="button"
                data-try-tap=""
                onClick={atReef ? restart : depart}
                className={
                  atReef
                    ? buttonClass({ variant: "link", size: "sm", flush: true })
                    : buttonClass({ variant: "primary", size: "sm", className: "mt-2" })
                }
              >
                {atReef ? labels.restart : labels.depart}
              </button>
            ) : null}
          </>
        )}
      </figcaption>
    </>
  );
}
