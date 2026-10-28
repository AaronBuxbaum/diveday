// i18n-exempt-file: every visible label arrives as an already-translated prop.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import type {
  AgencyCheckOffer,
  AgencyCheckResult,
  AgencyListedAddResult,
} from "@/app/shop/[shopSlug]/divers/[personId]/agency-check-actions";
import { UndoToast } from "@/components/UndoToast";
import { proseLinkClass } from "@/components/ui/button";
import { requestAgencyPage, useCertCheckExtension } from "@/components/useCertCheckExtension";
import type { AgencyListedKind, CheckableAgency } from "@/lib/agency-check";
import {
  AGENCY_CHECK_QUEUE_PAUSE_MS,
  type AgencyCheckableCard,
  type AgencyCheckOutcome,
  type AgencyCheckQueueSummary,
  runAgencyCheckQueue,
} from "@/lib/agency-check-queue";
import { shopPath } from "@/lib/staff-notices";
import { AgencyListedOffer, agencyListedForm } from "./AgencyListedOffer";
import type { AgencyCheckAgencyCopy } from "./agency-check-copy";
import {
  type AgencyCheckFailure,
  agencyCheckFailure,
  agencyCheckForm,
  agencyCheckMatchedText,
  agencyCheckOutcome,
} from "./agency-check-outcome";
import { reportFailedCheck } from "./report-failed-check";

/** `agencyCheckAction`, bound to the shop on the server; the diver is the card's. */
export type AgencyCheckHostAction = (
  personId: string,
  previous: AgencyCheckResult,
  formData: FormData,
) => Promise<AgencyCheckResult>;

/** `addAgencyListedCardsAction`, bound to the shop on the server; the diver is the card's. */
export type AgencyListedHostAction = (
  personId: string,
  previous: AgencyListedAddResult,
  formData: FormData,
) => Promise<AgencyListedAddResult>;

/** Where one card's check stands on this page. */
export type AgencyCheckCardState =
  | { phase: "checking" }
  | {
      phase: "settled";
      result: AgencyCheckResult;
      /** The extension came back with no page: nothing was judged or written. */
      failure: AgencyCheckFailure;
      /** Pressed on its own row ("one"), or one card of a departure's "Check all". */
      via: "one" | "all";
      /**
       * The page the server judged, kept only when its match offered the
       * diver's other cards (layer 3), so a tick posts the same text back,
       * and dropped once they are filed (S5).
       */
      pageText?: string;
      /** The offer's cards were filed: it stays on screen saying so, with no page kept. */
      listedAdded?: true;
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
  /** Run these cards one at a time, skipping any this page already settled. */
  runAll: (cards: readonly AgencyCheckableCard[]) => void;
  /** Stop a running "Check all" after the card in flight. */
  stopAll: () => void;
  /** File the ticked cards a match's page listed, as pending. */
  addListed: (
    card: AgencyCheckableCard,
    kinds: AgencyListedKind[],
  ) => Promise<AgencyListedAddResult>;
  /**
   * Where a match's other cards are offered: under the diver's row (a
   * departure, whose rows stay), or in the page's own slot
   * (`AgencyListedOffersSlot`: Today, whose row leaves with the card it was
   * about).
   */
  offersAt: "row" | "slot";
};

/**
 * The cards a "Check all" would still send: those this page has not already
 * settled with a verdict from the agency's page. A card that came back with
 * no verdict (the extension, DiveDay or a sign-in in the way) goes again, so a
 * re-run never stops at the same diver for the same reason.
 */
export function agencyCheckCardsToRun(
  cards: readonly AgencyCheckableCard[],
  states: Record<string, AgencyCheckCardState>,
): AgencyCheckableCard[] {
  return cards.filter((card) => {
    if (card.agency === "ssi") return false;
    const state = states[card.certificationId];
    return !(state?.phase === "settled" && state.failure === null && state.result !== null);
  });
}

/**
 * The other cards a match's page offered for this card, while the page text
 * to post them with is kept or once they are filed; null for anything else.
 */
export function agencyListedOffers(
  state: AgencyCheckCardState | undefined,
): readonly AgencyCheckOffer[] | null {
  if (state?.phase !== "settled" || !(state.pageText || state.listedAdded)) return null;
  const result = state.result;
  return result?.ok === true && result.verdict === "match" && result.offers?.length
    ? result.offers
    : null;
}

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
 * `runAgencyCheckQueue`, which pauses between lookups, skips one unreadable
 * result, stops on two in a row or on a signed-out agency, and stops when the
 * staffer says so. A re-run skips the cards this page already settled. The
 * page repaints once, when a run that certified something ends. While
 * anything is in flight every other button waits, so the page never sends two
 * lookups at once.
 *
 * Undo is per card and nothing else: a single check's toast, or the line a
 * "Check all" leaves on each row it certified. There is no Undo for a whole
 * departure, so one wrong tap can never uncertify a boat.
 */
export function AgencyCheckHost({
  action,
  addListedAction,
  offersAt = "row",
  copies,
  pauseMs = AGENCY_CHECK_QUEUE_PAUSE_MS,
  children,
}: {
  action: AgencyCheckHostAction;
  /** Without it, a match's other cards are not offered. */
  addListedAction?: AgencyListedHostAction;
  offersAt?: "row" | "slot";
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
  const [toast, setToast] = useState<{
    card: AgencyCheckableCard;
    key: number;
    message: string;
  } | null>(null);
  const router = useRouter();
  const alive = useRef(true);
  const inFlight = useRef(false);
  const stopRequested = useRef(false);
  const toasts = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** One card, end to end: the extension reads the page, the server judges it. */
  const checkCard = useCallback(
    async (
      card: AgencyCheckableCard,
      via: "one" | "all",
    ): Promise<{ outcome: AgencyCheckOutcome; result: AgencyCheckResult }> => {
      setCards((previous) => ({ ...previous, [card.certificationId]: card }));
      setStates((previous) => ({ ...previous, [card.certificationId]: { phase: "checking" } }));
      const settle = (
        result: AgencyCheckResult,
        failure: AgencyCheckFailure,
        pageText?: string,
      ) => {
        if (!alive.current) return;
        const offered =
          addListedAction && result?.ok === true && result.verdict === "match" && result.offers;
        setStates((previous) => ({
          ...previous,
          [card.certificationId]: {
            phase: "settled",
            result,
            failure,
            via,
            ...(offered && pageText ? { pageText } : {}),
          },
        }));
      };
      const reply = await requestAgencyPage(card.query);
      if (!reply.ok) {
        // Signed out of PADI stops a "Check all" at once, and says why: every
        // PADI card after it would meet the same sign-in. Any other failure is
        // a page that could not be read, and its shape goes to DiveDay's log.
        reportFailedCheck(card.agency, reply);
        const failure = agencyCheckFailure(reply.reason);
        settle(null, failure);
        return { outcome: agencyCheckOutcome(null, failure) ?? "unreadable", result: null };
      }
      let result: AgencyCheckResult;
      try {
        result = await action(
          card.personId,
          null,
          // A run repaints the page once, at its end (`runAll`).
          agencyCheckForm(card.certificationId, reply.pageText, {
            refreshLater: via === "all",
            cardType: card.cardType,
          }),
        );
      } catch {
        // DiveDay's own server did not answer: the card may or may not have
        // been written, and the staffer is told to reload and see.
        settle(null, "transport");
        return { outcome: "transport", result: null };
      }
      settle(result, null, reply.pageText);
      return { outcome: agencyCheckOutcome(result, null) ?? "refused", result };
    },
    [action, addListedAction],
  );

  const checkOne = useCallback(
    (card: AgencyCheckableCard) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setSingleBusy(true);
      void checkCard(card, "one").then(({ result }) => {
        inFlight.current = false;
        if (!alive.current) return;
        setSingleBusy(false);
        const copy = copies[card.agency];
        if (result?.ok && result.verdict === "match" && copy) {
          toasts.current += 1;
          setToast({ card, key: toasts.current, message: agencyCheckMatchedText(result, copy) });
        }
      });
    },
    [checkCard, copies],
  );

  const runAll = useCallback(
    (list: readonly AgencyCheckableCard[]) => {
      const toRun = agencyCheckCardsToRun(list, states);
      if (inFlight.current || toRun.length === 0) return;
      inFlight.current = true;
      stopRequested.current = false;
      setToast(null);
      const total = toRun.length;
      setQueue({ phase: "running", done: 0, total });
      void runAgencyCheckQueue({
        cards: toRun,
        check: async (card) => (await checkCard(card, "all")).outcome,
        pause,
        pauseMs,
        onStart: (_card, done) => {
          if (alive.current) setQueue({ phase: "running", done: done + 1, total });
        },
        cancelled: () => !alive.current || stopRequested.current,
      }).then((summary) => {
        inFlight.current = false;
        if (!alive.current) return;
        setQueue({ phase: "ended", total, ...summary });
        // Each card's post left the repaint to here: once for the whole run,
        // and only when it wrote something.
        if (summary.certified + summary.confirmed > 0) router.refresh();
      });
    },
    [checkCard, pauseMs, states, router],
  );

  const stopAll = useCallback(() => {
    stopRequested.current = true;
  }, []);

  const undo = useCallback(
    async (card: AgencyCheckableCard) => {
      const formData = new FormData();
      formData.set("certificationId", card.certificationId);
      if (card.cardType) formData.set("cardType", card.cardType);
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
          [card.certificationId]: { phase: "settled", result, failure: null, via },
        };
      });
    },
    [action],
  );

  const addListed = useCallback(
    (card: AgencyCheckableCard, kinds: AgencyListedKind[]) => {
      const state = states[card.certificationId];
      const pageText = state?.phase === "settled" ? state.pageText : undefined;
      if (!pageText || !addListedAction) {
        return Promise.resolve<AgencyListedAddResult>({ ok: false });
      }
      const settle = (result: AgencyListedAddResult) => {
        // Filed: the page's text has done its work and is not kept (S5).
        if (result?.ok && alive.current) {
          setStates((previous) => {
            const current = previous[card.certificationId];
            if (current?.phase !== "settled") return previous;
            const { pageText: _dropped, ...rest } = current;
            return { ...previous, [card.certificationId]: { ...rest, listedAdded: true } };
          });
        }
        return result;
      };
      return addListedAction(
        card.personId,
        null,
        agencyListedForm(card.certificationId, pageText, kinds),
      ).then(settle);
    },
    [addListedAction, states],
  );

  const busy = singleBusy || queue.phase === "running";
  const value = useMemo<HostValue>(
    () => ({
      hasExtension,
      copies,
      cards,
      states,
      busy,
      checkOne,
      undo,
      queue,
      runAll,
      stopAll,
      addListed,
      offersAt,
    }),
    [
      hasExtension,
      copies,
      cards,
      states,
      busy,
      checkOne,
      undo,
      queue,
      runAll,
      stopAll,
      addListed,
      offersAt,
    ],
  );
  const toastCopy = toast ? copies[toast.card.agency] : null;
  return (
    <HostContext.Provider value={value}>
      {children}
      {toast && toastCopy ? (
        <UndoToast
          key={toast.key}
          message={toast.message}
          action={() => undo(toast.card)}
          fields={{}}
          pendingLabel={toastCopy.undoPending}
          undoLabel={toastCopy.undo}
          dismissLabel={toastCopy.dismiss}
        />
      ) : null}
    </HostContext.Provider>
  );
}

/**
 * **Where a page that is not a list of rows puts a match's other cards**
 * (layer 3, D8): Today draws it under its Needs you list, because a row whose
 * card the check certified leaves that list on the refresh that follows. Each
 * offer names the diver, linked to their record, where the cards it files will
 * wait for Mark certified. Draws nothing outside a host offering them here.
 */
export function AgencyListedOffersSlot({ shopSlug }: { shopSlug: string }) {
  const host = useAgencyCheckHost();
  if (host?.offersAt !== "slot") return null;
  const offered = Object.values(host.cards).flatMap((card) => {
    const offers = agencyListedOffers(host.states[card.certificationId]);
    const copy = host.copies[card.agency];
    return offers && copy ? [{ card, offers, copy }] : [];
  });
  if (offered.length === 0) return null;
  return (
    <div className="mt-3" data-agency-listed-offers="">
      {offered.map(({ card, offers, copy }) => {
        const [before, after = ""] = copy.listedLeadFor.split("{name}");
        return (
          <AgencyListedOffer
            key={card.certificationId}
            lead={
              <>
                {before}
                <Link href={shopPath(shopSlug, "divers", card.personId)} className={proseLinkClass}>
                  {card.fullName}
                </Link>
                {after}
              </>
            }
            offers={offers}
            copy={copy}
            add={(kinds) => host.addListed(card, kinds)}
          />
        );
      })}
    </div>
  );
}
