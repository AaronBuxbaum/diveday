"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { fill, pluralForm } from "@/i18n/fill";
import { MEDICAL_FIELD_PREFIX } from "@/lib/medical";
import {
  WAIVER_RAIL_TOTAL,
  type WaiverRailSegmentId,
  WaiverStepRail,
  waiverRailProgress,
} from "./WaiverStepRail";

/**
 * **What the waiver page knows about how far along the diver is** — ADR
 * 20260827-the-divers-thread, decision 5 (slice 7e).
 *
 * The medical questions are uncontrolled, server-rendered radios, and they stay
 * that way: nothing here reads `FormData`, gates a submit, or replaces the
 * radios' own `required` validation. What this adds is one delegated `change`
 * listener over the whole page, so *two* things can read one count — the step
 * rail at the top of the page and the sticky counter over the questions
 * themselves — without either of them observing the other's DOM.
 *
 * That count used to live inside `QuestionnaireProgress`, which wrapped only
 * the questionnaire. The rail sits above the release, outside the form, so the
 * owner of the count moved up here and the counter became a consumer. Same
 * mechanism, same `data-question-scope` contract, one owner.
 *
 * Pure progressive enhancement: before hydration the rail renders at whatever
 * the draft seeds, the questions submit exactly as they do without JavaScript,
 * and every refusal is still enforced server-side. **The seed is a prop, not an
 * effect.** A delegated listener by definition sees nothing that happened
 * before it mounted, so a rail whose only seed was a post-mount DOM scan
 * shipped "0 of 3 done" in the HTML above a form the server had just filled in
 * from a saved draft — wrong on dock wifi until the bundle boots, and permanent
 * with JavaScript off, which this page deliberately still supports. The page
 * knows both figures already; it hands them over.
 */

type MedicalDraftCount = {
  /** Page-one questions answered so far. */
  answered: number;
  /** How many page-one questions are on screen. */
  total: number;
  /** The reader's negotiated locale, for plural selection in a client render. */
  locale: string;
};

const MedicalDraftContext = createContext<MedicalDraftCount | null>(null);

/** The page-one questions: the fixed list the diver was handed. */
const PRIMARY_RADIOS = `input[type="radio"][name^="${MEDICAL_FIELD_PREFIX}"][data-question-scope="primary"]`;
/**
 * The questions a diver's own yes put on the page. They exist in the DOM only
 * while the answer that opened them stands, so what is on screen *is* the
 * applicable set — no second copy of `applicableMedicalQuestions` here.
 */
const FOLLOW_UP_RADIOS = `input[type="radio"][name^="${MEDICAL_FIELD_PREFIX}"][data-question-scope="follow-up"]`;

/**
 * The live count, for a component rendered under {@link WaiverPacing}. Returns
 * null when there is no provider above — this page's counter falls back to its
 * own server-known total rather than throwing, because a crash on a safety
 * surface is worse than a counter that reads zero.
 */
export function useMedicalDraftCount(): MedicalDraftCount | null {
  return useContext(MedicalDraftContext);
}

export function WaiverPacing({
  labels,
  progressOne,
  progressOther,
  anchors,
  medicalTotal,
  initialAnswered,
  initialFollowUpsRemaining,
  locale,
  children,
}: {
  /** The three rail segment names, already translated. */
  labels: Record<WaiverRailSegmentId, string>;
  /**
   * `waiver.railProgressOne` / `…Other` as raw templates (`t.raw`), filled here
   * with the live figures — this page has no `DiverIntlProvider`, so a client
   * component on it cannot call `useTranslations()` for itself. Same
   * `fill()`-template pattern the questionnaire counter already uses.
   */
  progressOne: string;
  progressOther: string;
  /** Set by the page only when a refusal has named a field a segment owns. */
  anchors?: Partial<Record<WaiverRailSegmentId, string>>;
  /** How many page-one questions this jurisdiction's form asks. */
  medicalTotal: number;
  /**
   * The page-one field names the server has already rendered answered, off the
   * saved draft — the first paint's own count, and the state this starts at.
   * Names rather than a number: a diver changing a question the draft already
   * answered fires a `change` this would otherwise add on top of the seed.
   */
  initialAnswered: readonly string[];
  /** Blank follow-ups the saved draft's own answers put on the page. */
  initialFollowUpsRemaining: number;
  locale: string;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [answered, setAnswered] = useState<Set<string>>(() => new Set(initialAnswered));
  const [questionTotal, setQuestionTotal] = useState(medicalTotal);
  const [followUpsRemaining, setFollowUpsRemaining] = useState(initialFollowUpsRemaining);

  const refreshFromDom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // The page-one questions are static, so re-deriving the denominator is
    // belt-and-braces: it stays honest if the questionnaire ever grows a
    // primary question that appears conditionally.
    const names = new Set(
      Array.from(container.querySelectorAll<HTMLInputElement>(PRIMARY_RADIOS), (i) => i.name),
    );
    setQuestionTotal(names.size || medicalTotal);
    // Everything on screen that is answered, whoever answered it: the server
    // from a draft, the diver a moment ago, or React re-opening a Box whose
    // children it had already set. The delegated listener below sees only the
    // middle one, and the set is a union so nothing it saw is ever dropped.
    setAnswered((previous) => {
      const next = new Set(previous);
      for (const input of container.querySelectorAll<HTMLInputElement>(
        `${PRIMARY_RADIOS}:checked`,
      )) {
        next.add(input.name);
      }
      // A union can only grow, so equal sizes mean nothing new — return the
      // same reference rather than a fresh set React would re-render for.
      return next.size === previous.size ? previous : next;
    });
    // One entry per follow-up question, true once either of its radios is
    // chosen. What is left false is what an honest yes has opened and the diver
    // has not answered — the thing that keeps Medical open.
    const followUps = new Map<string, boolean>();
    for (const input of container.querySelectorAll<HTMLInputElement>(FOLLOW_UP_RADIOS)) {
      followUps.set(input.name, (followUps.get(input.name) ?? false) || input.checked);
    }
    let open = 0;
    for (const settled of followUps.values()) {
      if (!settled) open += 1;
    }
    setFollowUpsRemaining(open);
  }, [medicalTotal]);

  useEffect(() => {
    refreshFromDom();
    const observer = new MutationObserver(refreshFromDom);
    if (containerRef.current)
      observer.observe(containerRef.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [refreshFromDom]);

  function handleChange(event: React.ChangeEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      !(target instanceof HTMLInputElement) ||
      target.type !== "radio" ||
      !target.name.startsWith(MEDICAL_FIELD_PREFIX)
    ) {
      return;
    }
    // A Box answer is real progress, but it is not progress through the
    // questions the *counter* measures — counting it there would push the
    // numerator past the denominator. It still closes the medical step, which
    // is what the rescan below picks up: opening or closing a Box is a DOM
    // change the observer sees, but answering one already on screen is not.
    if (target.dataset.questionScope === "primary") {
      setAnswered((prev) => (prev.has(target.name) ? prev : new Set(prev).add(target.name)));
    }
    queueMicrotask(refreshFromDom);
  }

  // `signed: false`, always — this component only ever renders on the page a
  // diver is still filling in. The completed state renders the rail itself,
  // from the server.
  const progress = waiverRailProgress({
    medicalAnswered: answered.size,
    medicalTotal: questionTotal,
    medicalFollowUpsRemaining: followUpsRemaining,
    signed: false,
  });

  const doneLabel = fill(
    pluralForm(progress.done, { one: progressOne, other: progressOther }, locale),
    { done: progress.done, total: WAIVER_RAIL_TOTAL },
  );

  return (
    <div ref={containerRef} onChange={handleChange}>
      <WaiverStepRail
        className="mt-6"
        progress={progress}
        labels={labels}
        anchors={anchors}
        doneLabel={doneLabel}
      />
      <MedicalDraftContext.Provider
        value={{ answered: answered.size, total: questionTotal, locale }}
      >
        {children}
      </MedicalDraftContext.Provider>
    </div>
  );
}
