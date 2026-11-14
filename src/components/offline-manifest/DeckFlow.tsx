"use client";

import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import { ITEM_TITLE_CLASS, SHELL_TITLE_CLASS, SUB_TITLE_CLASS } from "@/components/ui/typography";
import { formatDateTimeTz } from "@/lib/format";
import { wallTimeToUtc } from "@/lib/zoned";

export type DeckPerson = {
  id: string;
  name: string;
  role: string;
  outstanding: boolean;
  attention?: boolean;
  requiresReview?: boolean;
  status?: string;
  observed?: string;
  eventId?: string;
  pending?: boolean;
  record: ReactNode;
  undo?: ReactNode;
  details: ReactNode;
};

export type DeckCopy = {
  title: string;
  start: string;
  next: string;
  later: string;
  find: string;
  search: string;
  home: string;
  details: string;
  exception: string;
  receipt: string;
  pendingReceipt: string;
  complete: string;
  attention: string;
  review: string;
  empty: string;
  observe: string;
  now: string;
  savedAboard: string;
  savedAshore: string;
  savedMissing: string;
  observed: string;
};

type DeckMutation = {
  saved: (
    id: string,
    status: string,
    receipt?: { observedAt?: string; pending?: boolean; eventId?: string; evidenceId?: string },
  ) => void;
  setBusy: (busy: boolean) => void;
  observedAt?: string;
  eventId?: string;
  evidenceId?: string;
  setDeviceNotice: (message: string | null) => void;
};
const DeckMutationContext = createContext<DeckMutation | null>(null);
export const useDeckMutation = () => useContext(DeckMutationContext);

function DeckFind({
  people,
  copy,
  query,
  setQuery,
  openPerson,
  navigationClass,
}: {
  people: DeckPerson[];
  copy: DeckCopy;
  query: string;
  setQuery: (value: string) => void;
  openPerson: (id: string) => void;
  navigationClass: string;
}) {
  return (
    <div className="py-4">
      <label htmlFor="deck-find" className="sr-only">
        {copy.search}
      </label>
      <input
        id="deck-find"
        type="search"
        className={controlClass}
        value={query}
        placeholder={copy.search}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="mt-3 divide-y divide-border">
        {people
          .filter((item) => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          .map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-label={
                  people.some((other) => other.id !== item.id && other.name === item.name)
                    ? `${item.name} · ${item.role}`
                    : item.name
                }
                className={`${navigationClass} my-1 justify-start text-start`}
                onClick={() => openPerson(item.id)}
              >
                {item.name}
                <span className="ms-auto text-sm text-muted">{item.role}</span>
              </button>
            </li>
          ))}
      </ul>
      {!people.length ? <p>{copy.empty}</p> : null}
    </div>
  );
}

function DeckObservation({
  copy,
  timeZone,
  busy,
  value,
  onChange,
}: {
  copy: DeckCopy;
  timeZone: string;
  busy: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor="deck-observed-at" className="block text-sm font-semibold">
        {copy.observe} · {timeZone}
      </label>
      <input
        id="deck-observed-at"
        type="datetime-local"
        disabled={busy}
        className={`${controlClass} mt-2`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        disabled={busy}
        className={buttonClass({ variant: "link" })}
        onClick={() => onChange("")}
      >
        {copy.now}
      </button>
    </div>
  );
}

function observationInstant(observation: string, timeZone: string) {
  const parts = observation.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  return parts
    ? wallTimeToUtc(
        {
          year: Number(parts[1]),
          month: Number(parts[2]),
          day: Number(parts[3]),
          hour: Number(parts[4]),
          minute: Number(parts[5]),
        },
        timeZone,
      ).toISOString()
    : undefined;
}

/** Navigation never invokes a recording action. Receipts are an explicit saved outcome. */
export function DeckFlow({
  people,
  copy,
  checkpoint,
  progress,
  complete,
  attention,
  details,
  delivery,
  timeZone,
  status,
  exit,
  isDeparture = false,
  locale,
}: {
  people: DeckPerson[];
  copy: DeckCopy;
  checkpoint: ReactNode;
  progress: string;
  complete: boolean;
  attention?: ReactNode;
  details?: ReactNode;
  delivery?: ReactNode;
  timeZone: string;
  status?: ReactNode;
  exit?: ReactNode;
  isDeparture?: boolean;
  locale: string;
}) {
  const [screen, setScreen] = useState<"home" | "person" | "receipt" | "find" | "attention">(
    "home",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [exception, setException] = useState(false);
  const [observation, setObservation] = useState("");
  const [receipt, setReceipt] = useState<{
    id: string;
    status: string;
    observedAt?: string;
    pending?: boolean;
    eventId?: string;
    evidenceId?: string;
  } | null>(null);
  const [deviceNotice, setDeviceNotice] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const observedAt = observationInstant(observation, timeZone);
  const person = people.find((item) => item.id === selected);
  const hasAttention = Boolean(attention) || people.some((item) => item.attention);
  const openPerson = (id: string) => {
    setSelected(id);
    setException(false);
    setScreen("person");
  };
  const next = () => {
    const index = people.findIndex((item) => item.id === selected);
    const ordered = [...people.slice(index + 1), ...people.slice(0, index + 1)];
    const candidate = ordered.find((item) => item.outstanding && item.id !== selected);
    if (candidate) openPerson(candidate.id);
    else setScreen("home");
  };
  const navigationClass = buttonClass({ variant: "secondary", size: "boat", className: "w-full" });
  const primaryClass = buttonClass({ size: "boat", className: "min-h-18 w-full text-lg" });
  return (
    <DeckMutationContext.Provider
      value={{
        saved: (id, status, evidence) => {
          if (!people.some((item) => item.id === id)) return;
          setSelected(id);
          setReceipt({ id, status, ...evidence });
          setException(false);
          setScreen(status === "cleared" ? "person" : "receipt");
        },
        setBusy,
        observedAt,
        eventId: receipt?.id === selected ? receipt.eventId : undefined,
        evidenceId: receipt?.id === selected ? receipt.evidenceId : undefined,
        setDeviceNotice,
      }}
    >
      <section
        id="deck-flow"
        data-deck-screen={screen}
        className="mx-auto w-full max-w-xl"
        aria-label={copy.title}
      >
        <div className="flex items-center justify-between gap-3">
          <h1 className={ITEM_TITLE_CLASS} aria-label={copy.title}>
            <button
              type="button"
              disabled={busy}
              aria-label={copy.home}
              className={buttonClass({ variant: "link", flush: true, className: "min-w-11" })}
              onClick={() => setScreen("home")}
            >
              {copy.title}
            </button>
          </h1>
          {exit}
        </div>
        <div className="mt-1">{checkpoint}</div>
        <p className="mt-1 text-base font-semibold tabular-nums">{progress}</p>
        {status}
        {deviceNotice ? (
          <button
            type="button"
            data-deck-device-status
            className={buttonClass({ variant: "danger", className: "mt-2 w-full text-start" })}
            onClick={() => {
              if (detailsRef.current) detailsRef.current.open = true;
            }}
          >
            {deviceNotice}
          </button>
        ) : null}
        {observation ? (
          <p className="mt-1 text-sm font-semibold text-warning-strong">
            {copy.observe}: {observation.replace("T", " ")} · {timeZone}
          </p>
        ) : null}
        {delivery ? (
          <div className="mt-1 text-base" role="status">
            {delivery}
          </div>
        ) : null}
        {hasAttention && screen !== "attention" ? (
          <button
            type="button"
            disabled={busy}
            className={buttonClass({ variant: "danger", className: "mt-3 w-full" })}
            onClick={() => setScreen("attention")}
          >
            {copy.attention}
          </button>
        ) : null}
        {screen === "home" ? (
          <div className="flex min-h-52 flex-col justify-center gap-4 py-6">
            {complete && !hasAttention ? (
              <p className={SUB_TITLE_CLASS} role="status">
                {copy.complete}
              </p>
            ) : null}
            {hasAttention ? (
              <button type="button" className={primaryClass} onClick={() => setScreen("attention")}>
                {copy.review}
              </button>
            ) : null}
            <button
              type="button"
              className={hasAttention ? navigationClass : primaryClass}
              disabled={!people.length}
              onClick={() => {
                const first = people.find((item) => item.outstanding) ?? people[0];
                if (first) openPerson(first.id);
              }}
            >
              {copy.start}
            </button>
          </div>
        ) : null}
        {(screen === "person" || screen === "receipt") && person ? (
          <div className="py-2" key={person.id}>
            <p className="text-sm text-muted">{person.role}</p>
            <h2 className={`mt-1 ${SHELL_TITLE_CLASS} wrap-anywhere`}>{person.name}</h2>
            {screen === "receipt" ? (
              <>
                <p className={`mt-2 ${ITEM_TITLE_CLASS}`} role="status">
                  {receipt?.id === person.id
                    ? receipt.status === "boarded"
                      ? copy.savedAboard
                      : isDeparture
                        ? copy.savedAshore
                        : copy.savedMissing
                    : (person.status ?? copy.receipt)}
                </p>
                {receipt?.id === person.id &&
                (receipt.eventId && receipt.eventId === person.eventId
                  ? person.pending
                  : receipt.pending) ? (
                  <p className="mt-1 text-base">{copy.pendingReceipt}</p>
                ) : null}
                {receipt?.id === person.id && receipt.observedAt ? (
                  <p className="mt-1 text-sm">
                    {copy.observed}:{" "}
                    <time dateTime={receipt.observedAt}>
                      {formatDateTimeTz(new Date(receipt.observedAt), locale, timeZone)}
                    </time>
                  </p>
                ) : receipt?.eventId && receipt.eventId === person.eventId && person.observed ? (
                  <p className="mt-1 text-sm">{person.observed}</p>
                ) : null}
                {person.requiresReview ? (
                  <button
                    type="button"
                    className={`${navigationClass} mt-4`}
                    onClick={() => setException(true)}
                  >
                    {copy.review}
                  </button>
                ) : (
                  <div className="mt-2">{person.undo}</div>
                )}
                <button
                  type="button"
                  disabled={busy}
                  className={`${primaryClass} mt-2`}
                  onClick={next}
                >
                  {copy.next}
                </button>
              </>
            ) : (
              <>
                {person.status ? (
                  <p className="mt-2 text-sm font-semibold">{person.status}</p>
                ) : null}
                <div className="mt-5">{person.record}</div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className={buttonClass({ variant: "link", className: "min-h-11 w-full px-0" })}
                    onClick={() => setException((value) => !value)}
                  >
                    {copy.exception}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={buttonClass({ variant: "link", className: "min-h-11 w-full px-0" })}
                    onClick={next}
                  >
                    {copy.later}
                  </button>
                </div>
              </>
            )}
            {exception ? <div className="mt-5">{person.details}</div> : null}
          </div>
        ) : null}
        {screen === "find" ? (
          <DeckFind {...{ people, copy, query, setQuery, openPerson, navigationClass }} />
        ) : null}
        {screen === "attention" ? (
          <div className="space-y-4 py-4">
            {attention}
            {people
              .filter((item) => item.attention)
              .map((item) => (
                <div key={item.id}>
                  <button
                    type="button"
                    className={navigationClass}
                    onClick={() => {
                      openPerson(item.id);
                      setException(true);
                    }}
                  >
                    {item.name}
                  </button>
                </div>
              ))}
          </div>
        ) : null}
        <div className="grid grid-cols-2 border-t border-border pt-2">
          <button
            type="button"
            disabled={busy}
            className={buttonClass({ variant: "link", className: "min-h-11" })}
            onClick={() => setScreen("find")}
          >
            {copy.find}
          </button>
          <details ref={detailsRef} className="contents">
            <summary className="flex min-h-11 cursor-pointer items-center justify-center font-semibold">
              {copy.details}
            </summary>
            <div className="col-span-2 mt-4 space-y-6">
              <DeckObservation
                {...{ copy, timeZone, busy }}
                value={observation}
                onChange={setObservation}
              />
              {details}
            </div>
          </details>
        </div>
      </section>
    </DeckMutationContext.Provider>
  );
}
