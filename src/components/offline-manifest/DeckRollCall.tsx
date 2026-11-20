import { type ReactNode, useState } from "react";
import { refusePress, wasMultiTouch } from "@/components/roll-call-touch-guard";
import { ErrorToast, SAFETY_TOAST_MS } from "@/components/Toast";
import { buttonClass } from "@/components/ui/button";
import { rollCallCheckpointText, rollCallLabelText } from "@/i18n/manifest-labels";
import { formatDateTimeTz } from "@/lib/format";
import { physicalPeople } from "@/lib/manifest-person-counts";
import { isNotBackAboard, rollCallLabel } from "@/lib/manifests";
import { offlineCausalContext } from "@/lib/roll-call-offline-causality";
import { OfflineCrewRollCall } from "./CrewRollCall";
import type { OfflineTripControls } from "./controls";
import { DeckFlow, type DeckPerson, useDeckMutation } from "./DeckFlow";
import { OfflineDeckDelivery, OfflineDeckReference, OfflineDeckSafety } from "./DeckNotices";
import { OfflineDiverRow } from "./DiverRollCall";
import { deckCopy } from "./deck-copy";
import { offlineDiverRowFacts } from "./diver-row-facts";
import { PendingRollCallWarning } from "./PendingRollCallWarning";
import type { OfflineStatement } from "./shared";
import type { OfflineTripView } from "./trip-view";

function receiptEvidenceId(state: OfflineTripView["localStates"][number]): string | undefined {
  if (state?.clientEventId) return state.clientEventId;
  const evidence = state?.causalContext?.observedEvidenceIds;
  return evidence?.length === 1 && evidence[0]?.startsWith("client:")
    ? evidence[0].slice(7)
    : undefined;
}

function SavedPersonButton({
  id,
  subject,
  statement,
  controls,
  label,
  disabled = false,
  undo = false,
}: {
  id: string;
  subject: { bookingId: string } | { crewPersonId: string };
  statement: OfflineStatement;
  controls: OfflineTripControls;
  label: string;
  disabled?: boolean;
  undo?: boolean;
}) {
  const deck = useDeckMutation();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(0);
  if (undo && !deck?.eventId && !statement.retractsClientEventId) return null;
  return (
    <>
      <button
        type="button"
        disabled={disabled || pending}
        aria-busy={pending}
        className={buttonClass({
          variant: undo ? "link" : "primary",
          size: undo ? "boat" : "deck",
          className: undo ? "" : "w-full",
        })}
        onClick={async (event) => {
          if (wasMultiTouch()) {
            refusePress(event.currentTarget);
            return;
          }
          setPending(true);
          deck?.setBusy(true);
          try {
            const saved = await controls.record(subject, {
              ...statement,
              ...(statement.status === "cleared" && deck?.eventId
                ? { retractsClientEventId: deck.eventId }
                : {}),
              ...(deck?.observedAt && statement.status !== "cleared"
                ? { occurredAt: deck.observedAt }
                : {}),
            });
            if (saved === true || (saved && typeof saved === "object" && saved.ok))
              deck?.saved(
                id,
                statement.status,
                typeof saved === "object" && saved.ok ? saved : { pending: true },
              );
            else setFailure((value) => value + 1);
          } catch {
            setFailure((value) => value + 1);
          } finally {
            setPending(false);
            deck?.setBusy(false);
          }
        }}
      >
        {pending ? controls.t("words.busy.saving") : label}
      </button>
      {failure > 0 ? (
        <ErrorToast
          occurrenceKey={failure}
          durationMs={SAFETY_TOAST_MS}
          message={controls.t("shared.offlineManifest.single.record.genericError")}
        />
      ) : null}
    </>
  );
}

function OfflineDeckDetails({
  view,
  controls,
  index,
  crew = false,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
  index: number;
  crew?: boolean;
}) {
  const deck = useDeckMutation();
  const [failure, setFailure] = useState(0);
  const wrapped: OfflineTripControls = {
    ...controls,
    record: async (subject, statement, standing) => {
      deck?.setBusy(true);
      try {
        const saved = await controls.record(
          subject,
          {
            ...statement,
            ...(deck?.observedAt && statement.status !== "cleared"
              ? { occurredAt: deck.observedAt }
              : {}),
          },
          standing,
        );
        if (saved === true || (saved && typeof saved === "object" && saved.ok))
          deck?.saved(
            "bookingId" in subject ? subject.bookingId : subject.crewPersonId,
            statement.status,
            typeof saved === "object" && saved.ok ? saved : { pending: true },
          );
        else setFailure((value) => value + 1);
        return saved;
      } catch {
        setFailure((value) => value + 1);
        return false;
      } finally {
        deck?.setBusy(false);
      }
    },
  };
  const member = view.crewWithKeys[index];
  const diver = view.manifest.divers[index];
  return (
    <>
      {crew && member ? (
        <OfflineCrewRollCall view={{ ...view, crewWithKeys: [member] }} controls={wrapped} />
      ) : diver ? (
        <ul>
          <OfflineDiverRow diver={diver} index={index} view={view} controls={wrapped} />
        </ul>
      ) : null}
      {failure > 0 ? (
        <ErrorToast
          occurrenceKey={failure}
          durationMs={SAFETY_TOAST_MS}
          message={controls.t("shared.offlineManifest.single.record.genericError")}
        />
      ) : null}
    </>
  );
}

export function OfflineDeckRollCall({
  view,
  controls,
  attention,
  details,
}: {
  view: OfflineTripView;
  controls: OfflineTripControls;
  attention?: ReactNode;
  details: ReactNode;
}) {
  const { t } = controls;
  const timeZone = view.envelope.snapshot.shop.timezone;
  const guestPeople: DeckPerson[] = view.manifest.divers.map((diver, index) => {
    const facts = offlineDiverRowFacts(diver, index, view, controls);
    const state = view.localStates[index];
    const subject = { bookingId: diver.bookingId };
    const conflict = offlineCausalContext(
      view.envelope.snapshot,
      view.envelope.events,
      subject,
      view.checkpoint,
    ).conflict;
    const problem = facts.missing || conflict;
    const record = problem ? (
      <p key={diver.bookingId} className="font-semibold text-danger">
        {t("manifest.deck.missing")}
      </p>
    ) : facts.showBoardControl ? (
      <SavedPersonButton
        key={diver.bookingId}
        id={diver.bookingId}
        subject={subject}
        statement={{ status: "boarded" }}
        controls={controls}
        disabled={view.expired}
        label={t("manifest.deck.record", { name: diver.fullName })}
      />
    ) : (
      <p key={diver.bookingId} className="font-semibold text-danger">
        {facts.statusLine}
      </p>
    );
    const undo = !problem ? (
      <SavedPersonButton
        key={diver.bookingId}
        id={diver.bookingId}
        subject={subject}
        statement={{
          status: "cleared",
          retractsClientEventId: state?.local ? state.clientEventId : undefined,
        }}
        controls={controls}
        disabled={view.expired}
        undo
        label={t("manifest.deck.undo", { name: diver.fullName })}
      />
    ) : undefined;
    const personDetails = (
      <>
        {view.isDeparture &&
        facts.blockedAtDock &&
        !problem &&
        !diver.notHere &&
        !diver.turnedAway ? (
          <div className="mb-8 space-y-3">
            <p>{t("manifest.deck.physicalHint")}</p>
            <SavedPersonButton
              key={diver.bookingId}
              id={diver.bookingId}
              subject={subject}
              statement={{ status: "boarded", physicalPresenceOnly: true }}
              controls={controls}
              disabled={view.expired}
              label={t("manifest.deck.physical", { name: diver.fullName })}
            />
          </div>
        ) : null}
        <OfflineDeckDetails view={view} controls={controls} index={index} />
      </>
    );
    return {
      id: diver.bookingId,
      name: diver.fullName,
      role: t("manifest.deck.guest"),
      outstanding: !state || problem,
      attention:
        problem ||
        facts.blockedAtDock ||
        !!diver.recountRequired ||
        !!diver.historicalReviewRequired,
      requiresReview: problem || !!diver.recountRequired || !!diver.historicalReviewRequired,
      eventId: receiptEvidenceId(state),
      pending: state?.pending,
      status: state
        ? `${rollCallLabelText(t, rollCallLabel(view.checkpoint, state))}${state.pending ? ` · ${t("manifest.deck.pendingReceipt")}` : ""}${diver.historicalReviewRequired ? ` · ${t("manifest.deck.historicalReviewRequired")}` : diver.recountRequired ? ` · ${t("manifest.deck.recountRequired")} · ${t("manifest.deck.recountOfflineGuidance")}` : ""}`
        : diver.recountRequired
          ? `${t("manifest.deck.recountRequired")} · ${t("manifest.deck.recountOfflineGuidance")}`
          : diver.historicalReviewRequired
            ? t("manifest.deck.historicalReviewRequired")
            : undefined,
      observed: state
        ? t("manifest.deck.observed", {
            time: formatDateTimeTz(new Date(state.occurredAt), controls.locale, timeZone),
          })
        : undefined,
      record,
      undo,
      details: personDetails,
    };
  });
  const crewPeople: DeckPerson[] = view.crewWithKeys.map((member, index) => {
    const state = member.state;
    const subject = { crewPersonId: member.id ?? "" };
    const problem =
      isNotBackAboard(view.checkpoint, state) ||
      Boolean(
        member.id &&
          offlineCausalContext(
            view.envelope.snapshot,
            view.envelope.events,
            subject,
            view.checkpoint,
          ).conflict,
      );
    const record = problem ? (
      <p key={member.key} className="font-semibold text-danger">
        {t("manifest.deck.missing")}
      </p>
    ) : (
      <SavedPersonButton
        key={member.key}
        id={member.id ?? member.key}
        subject={subject}
        statement={{ status: "boarded" }}
        controls={controls}
        disabled={view.expired || !member.id}
        label={t("manifest.deck.record", { name: member.fullName })}
      />
    );
    const undo = !problem ? (
      <SavedPersonButton
        key={member.key}
        id={member.id ?? member.key}
        subject={subject}
        statement={{
          status: "cleared",
          retractsClientEventId: state?.local ? state.clientEventId : undefined,
        }}
        controls={controls}
        disabled={view.expired}
        undo
        label={t("manifest.deck.undo", { name: member.fullName })}
      />
    ) : undefined;
    const personDetails = (
      <OfflineDeckDetails key={member.key} view={view} controls={controls} index={index} crew />
    );
    return {
      id: member.id ?? member.key,
      name: member.fullName,
      role: t("manifest.deck.crew"),
      outstanding: !state || problem,
      attention:
        problem || !member.id || !!member.recountRequired || !!member.historicalReviewRequired,
      requiresReview: problem || !!member.recountRequired || !!member.historicalReviewRequired,
      eventId: receiptEvidenceId(state),
      pending: state?.pending,
      status: state
        ? `${rollCallLabelText(t, rollCallLabel(view.checkpoint, state))}${state.pending ? ` · ${t("manifest.deck.pendingReceipt")}` : ""}${member.historicalReviewRequired ? ` · ${t("manifest.deck.historicalReviewRequired")}` : member.recountRequired ? ` · ${t("manifest.deck.recountRequired")} · ${t("manifest.deck.recountOfflineGuidance")}` : ""}`
        : member.recountRequired
          ? `${t("manifest.deck.recountRequired")} · ${t("manifest.deck.recountOfflineGuidance")}`
          : member.historicalReviewRequired
            ? t("manifest.deck.historicalReviewRequired")
            : undefined,
      observed: state
        ? t("manifest.deck.observed", {
            time: formatDateTimeTz(new Date(state.occurredAt), controls.locale, timeZone),
          })
        : undefined,
      record,
      undo,
      details: personDetails,
    };
  });
  const people = [...guestPeople, ...crewPeople];
  const totalPeople = physicalPeople(view.manifest.divers, view.crewWithKeys);
  // Every role still needs its own evidence. A missing/conflicting role keeps
  // that physical person unresolved even when their other role is aboard.
  const outstandingPeople = physicalPeople(
    view.manifest.divers.filter((_diver, index) => guestPeople[index].outstanding),
    view.crewWithKeys.filter((_member, index) => crewPeople[index].outstanding),
  );
  return (
    <DeckFlow
      key={`${view.manifest.trip.id}:${view.checkpoint}:${controls.selectedMeetingDay ?? 0}`}
      people={people}
      copy={deckCopy(t)}
      checkpoint={
        <p className="font-semibold">
          {view.manifest.trip.title} · {rollCallCheckpointText(t, view.checkpoint)}
        </p>
      }
      progress={t("manifest.deck.progress", {
        count: totalPeople - outstandingPeople,
        total: totalPeople,
      })}
      complete={view.rollCallComplete}
      timeZone={timeZone}
      locale={controls.locale}
      isDeparture={view.isDeparture}
      status={<OfflineDeckSafety view={view} controls={controls} />}
      delivery={<OfflineDeckDelivery view={view} controls={controls} />}
      homeNotice={
        <PendingRollCallWarning
          t={t}
          pending={view.envelope.events.some((event) => event.syncStatus === "pending")}
        />
      }
      attention={attention}
      details={
        <>
          <OfflineDeckReference view={view} controls={controls} />
          <p>
            {t(
              controls.copyCaveat === "offline"
                ? "shared.offlineManifest.single.copyCaveatOffline"
                : controls.copyCaveat === "unanswered"
                  ? "shared.offlineManifest.single.copyCaveatUnanswered"
                  : "shared.offlineManifest.single.copyCaveatOnline",
              { when: view.savedAtZoned },
            )}
          </p>
          {details}
        </>
      }
    />
  );
}
