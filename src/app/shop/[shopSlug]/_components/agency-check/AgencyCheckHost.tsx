// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AgencyCheckResult } from "@/app/shop/[shopSlug]/divers/[personId]/card-actions";
import { UndoToast } from "@/components/UndoToast";
import { requestAgencyPage, useCertCheckExtension } from "@/components/useCertCheckExtension";
import type { CheckableAgency } from "@/lib/agency-check";
import {
  AGENCY_CHECK_QUEUE_PAUSE_MS,
  type AgencyCheckableCard,
  type AgencyCheckOutcome,
  type AgencyCheckQueueSummary,
  runAgencyCheckQueue,
} from "@/lib/agency-check-queue";
import type { AgencyCheckAgencyCopy } from "./agency-check-copy";
import { agencyCheckForm, agencyCheckOutcome } from "./agency-check-outcome";

/** `agencyCheckAction`, bound to the shop on the server; the diver is the card's. */
export type AgencyCheckHostAction = (
  personId: string,
  previous: AgencyCheckResult,
  formData: FormData,
) => Promise<AgencyCheckResult>;

/** Where one card's check stands on this page. */
export type AgencyCheckCardState =
  | { phase: "checking" }
  | {
      phase: "settled";
      result: AgencyCheckResult;
      transportFailed: boolean;
      /** Pressed on its own row ("one"), or one card of a departure's "Check all". */
      via: "one" | "all";
    };

/** Where a departure's "Check all" stands. */
export type AgencyCheckQueueState =
  | { phase: "idle" }
  | { phase: "running"; done: number; total: number }
  | ({ phase: "ended"; total: number } & AgencyCheckQueueSummary<AgencyCheckableCard>);

type HostValue = {
  hasExtension: boolean;
  copies: Record<CheckableAgency, AgencyCheckAgencyCopy>;
  /** Every card this page has checked, by id, so a row keeps its outcome after the card settles. */
  cards: Record<string, AgencyCheckableCard>;
  states: Record<string, AgencyCheckCardState>;
  /** A check or a run is in flight: every other button waits, one lookup at a time. */
  busy: boolean;
  checkOne: (card: AgencyCheckableCard) => void;
  undo: (card: AgencyCheckableCard) => Promise<void>;
  queue: AgencyCheckQueueState;
  runAll: (cards: readonly AgencyCheckableCard[]) => void;
};

const HostContext = createContext<HostValue | null>(null);

/** The page's agency check, or null where no host was drawn (a printed roster, the record). */
export function useAgencyCheckHost(): HostValue | null {
  return useContext(HostContext);
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * **The agency check on a page of many divers** (H-105): a departure's Divers
 * tab, or Today's "Needs you" list.
 *
 * One card's check is exactly the diver record's: the extension reads the
 * agency's page in the staffer's own browser, and `agencyCheckAction` decides
 * on the server, with the same match rule, the same stamp of who ran it and
 * the same Undo. What this adds is a place above the rows to keep what each
 * check came to, because a row whose card has just been certified re-renders
 * without it (it is no longer pending, and on Today the row itself may go),
 * and the Undo has to outlive that.
 *
 * It also owns a departure's "Check all": the cards go one at a time through
 * `runAgencyCheckQueue`, which pauses between lookups and stops on the first
 * page it cannot read. While anything is in flight every other button waits,
 * so the page never sends two lookups at once.
 *
 * Undo is per card and nothing else: a single check's toast, or the line a
 * "Check all" leaves on each row it certified. There is no Undo for a whole
 * departure, so one wrong tap can never uncertify a boat.
 */
export function AgencyCheckHost({
  action,
  copies,
  pauseMs = AGENCY_CHECK_QUEUE_PAUSE_MS,
  children,
}: {
  action: AgencyCheckHostAction;
  copies: Record<CheckableAgency, AgencyCheckAgencyCopy>;
  /** The pause between two lookups of a "Check all"; a test shortens it. */
  pauseMs?: number;
  children: ReactNode;
}) {
  const hasExtension = useCertCheckExtension();
  const [cards, setCards] = useState<Record<string, AgencyCheckableCard>>({});
  const [states, setStates] = useState<Record<string, AgencyCheckCardState>>({});
  const [queue, setQueue] = useState<AgencyCheckQueueState>({ phase: "idle" });
  const [singleBusy, setSingleBusy] = useState(false);
  // The single check whose toast is up, keyed so a second match lands as a new toast.
  const [toast, setToast] = useState<{ card: AgencyCheckableCard; key: number } | null>(null);
  const alive = useRef(true);
  const inFlight = useRef(false);
  const toasts = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** One card, end to end: the extension reads the page, the server judges it. */
  const checkCard = useCallback(
    async (card: AgencyCheckableCard, via: "one" | "all"): Promise<AgencyCheckOutcome> => {
      setCards((previous) => ({ ...previous, [card.certificationId]: card }));
      setStates((previous) => ({ ...previous, [card.certificationId]: { phase: "checking" } }));
      const settle = (result: AgencyCheckResult, transportFailed: boolean) => {
        if (!alive.current) return;
        setStates((previous) => ({
          ...previous,
          [card.certificationId]: { phase: "settled", result, transportFailed, via },
        }));
      };
      const reply = await requestAgencyPage(card.query);
      if (!reply.ok) {
        settle(null, true);
        return "transport";
      }
      let result: AgencyCheckResult;
      try {
        result = await action(
          card.personId,
          null,
          agencyCheckForm(card.certificationId, reply.pageText),
        );
      } catch {
        // DiveDay's own server did not answer: nothing was written that the
        // staffer was told about, and the run stops as for the extension.
        settle(null, true);
        return "transport";
      }
      settle(result, false);
      return agencyCheckOutcome(result, false) ?? "refused";
    },
    [action],
  );

  const checkOne = useCallback(
    (card: AgencyCheckableCard) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setSingleBusy(true);
      void checkCard(card, "one").then((outcome) => {
        inFlight.current = false;
        if (!alive.current) return;
        setSingleBusy(false);
        if (outcome === "match") {
          toasts.current += 1;
          setToast({ card, key: toasts.current });
        }
      });
    },
    [checkCard],
  );

  const runAll = useCallback(
    (list: readonly AgencyCheckableCard[]) => {
      if (inFlight.current || list.length === 0) return;
      inFlight.current = true;
      setToast(null);
      const total = list.length;
      setQueue({ phase: "running", done: 0, total });
      void runAgencyCheckQueue({
        cards: list,
        check: (card) => checkCard(card, "all"),
        pause,
        pauseMs,
        onStart: (_card, done) => {
          if (alive.current) setQueue({ phase: "running", done: done + 1, total });
        },
        cancelled: () => !alive.current,
      }).then((summary) => {
        inFlight.current = false;
        if (alive.current) setQueue({ phase: "ended", total, ...summary });
      });
    },
    [checkCard, pauseMs],
  );

  const undo = useCallback(
    async (card: AgencyCheckableCard) => {
      const formData = new FormData();
      formData.set("certificationId", card.certificationId);
      formData.set("intent", "undo");
      let result: AgencyCheckResult;
      try {
        result = await action(card.personId, null, formData);
      } catch {
        result = { ok: false, reason: "not-undoable" };
      }
      if (!alive.current) return;
      setToast((current) =>
        current?.card.certificationId === card.certificationId ? null : current,
      );
      setStates((previous) => {
        const before = previous[card.certificationId];
        const via = before?.phase === "settled" ? before.via : "one";
        return {
          ...previous,
          [card.certificationId]: { phase: "settled", result, transportFailed: false, via },
        };
      });
    },
    [action],
  );

  const busy = singleBusy || queue.phase === "running";
  const value = useMemo<HostValue>(
    () => ({ hasExtension, copies, cards, states, busy, checkOne, undo, queue, runAll }),
    [hasExtension, copies, cards, states, busy, checkOne, undo, queue, runAll],
  );
  const toastCopy = toast ? copies[toast.card.agency] : null;

  return (
    <HostContext.Provider value={value}>
      {children}
      {toast && toastCopy ? (
        <UndoToast
          key={toast.key}
          message={toastCopy.matched}
          action={() => undo(toast.card)}
          fields={{}}
          pendingLabel={toastCopy.undoPending}
          undoLabel={toastCopy.undo}
        />
      ) : null}
    </HostContext.Provider>
  );
}
