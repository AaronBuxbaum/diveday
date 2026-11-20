import Link from "next/link";
import type { ReactNode } from "react";
import { MixedTrainingDepthWarning } from "@/components/MixedTrainingDepthWarning";
import { DeckFlow, type DeckPerson } from "@/components/offline-manifest/DeckFlow";
import { deckCopy } from "@/components/offline-manifest/deck-copy";
import { buttonClass } from "@/components/ui/button";
import { rollCallLabelText } from "@/i18n/manifest-labels";
import { formatDateTimeTz } from "@/lib/format";
import { withholdHeldSeatParticulars } from "@/lib/held-seat";
import { physicalPeople } from "@/lib/manifest-person-counts";
import { isNotBackAboard, rollCallLabel } from "@/lib/manifests";
import { mixedTrainingDepthAdvisory } from "@/lib/training-mark";
import { RollCallButton } from "../../_components/RollCallButton";
import { CrewRollCall } from "./CrewRollCall";
import { diverBlockerText } from "./DiverFacts";
import { DiverRollCall } from "./DiverRollCall";
import type { readManifestView } from "./manifest-view";

type ManifestView = Extract<Awaited<ReturnType<typeof readManifestView>>, { status: "ready" }>;

/** A focused face over the same manifest and scalar actions as its paper and saved copy. */
export function DeckRollCall({
  view,
  checkpoint,
  attention,
  details,
  status,
  buddiesEnabled,
  exit,
}: {
  view: ManifestView;
  checkpoint: ReactNode;
  attention?: ReactNode;
  status?: ReactNode;
  buddiesEnabled: boolean;
  exit?: ReactNode;
  details: ReactNode;
}) {
  const { manifest, rollCall, actions } = view;
  const { t, shopSlug, tripId } = rollCall.divers;
  const recordClass = buttonClass({ size: "deck", className: "w-full" });
  const undoClass = buttonClass({ variant: "link", className: "min-h-11" });
  const divers = manifest.divers
    .map(withholdHeldSeatParticulars)
    .map((diver) => (buddiesEnabled ? diver : { ...diver, buddyTeam: undefined }));
  const crew = manifest.crew.map((member) =>
    buddiesEnabled ? member : { ...member, buddyTeams: [] },
  );
  const guestPeople: DeckPerson[] = divers.map((diver) => {
    const missing = isNotBackAboard(view.checkpoint, diver.rollCall);
    const conflict = diver.rollCallContext?.conflict === true;
    const blocked = view.isDeparture && diver.readiness?.status !== "ready";
    const subject = { field: "bookingId" as const, id: diver.bookingId };
    const copy = rollCall.divers.rollCallButtonCopy(diver.bookingId);
    const control = (status: "boarded" | "cleared", physicalPresenceOnly = false) => (
      <RollCallButton
        key={`${diver.bookingId}:${view.checkpoint}:${status}:${physicalPresenceOnly}`}
        action={actions.rollCall}
        subject={subject}
        status={status}
        retracts={status === "cleared" ? diver.rollCall?.eventId : undefined}
        physicalPresenceOnly={physicalPresenceOnly}
        label={t(
          status === "cleared"
            ? "manifest.deck.undo"
            : physicalPresenceOnly
              ? "manifest.deck.physical"
              : "manifest.deck.record",
          { name: diver.fullName },
        )}
        pendingLabel={t("words.busy.saving")}
        className={status === "cleared" ? undoClass : recordClass}
        copy={copy}
      />
    );
    return {
      id: diver.bookingId,
      name: diver.fullName,
      photoPath: diver.photoPath,
      role: t("manifest.deck.guest"),
      outstanding: !diver.rollCall || missing || conflict,
      attention:
        missing ||
        conflict ||
        blocked ||
        !!diver.recountRequired ||
        view.reader.alerted.has(diver.bookingId),
      requiresReview:
        missing || conflict || !!diver.recountRequired || view.reader.alerted.has(diver.bookingId),
      eventId: diver.rollCall?.eventId,
      status: diver.rollCall
        ? rollCallLabelText(t, rollCallLabel(view.checkpoint, diver.rollCall))
        : diver.recountRequired
          ? t("manifest.deck.recountRequired")
          : undefined,
      observed: diver.rollCall
        ? t("manifest.deck.observed", {
            time: formatDateTimeTz(
              diver.rollCall.occurredAt,
              rollCall.divers.locale,
              rollCall.divers.timezone,
            ),
          })
        : undefined,
      // Only recorded evidence says missing or conflicting. A cancelled
      // departure nobody counted on takes no writes: its people are not
      // counted, never missing (#2285).
      record:
        missing || conflict ? (
          <p className="font-semibold text-danger">{t("manifest.deck.missing")}</p>
        ) : view.cancelled === "closed" ? (
          <p className="font-semibold text-muted">{t("manifest.deck.notCounted")}</p>
        ) : blocked ? (
          <div>
            <ul className="space-y-2 text-danger">
              {diver.readiness?.blockers.map((blocker) => (
                <li key={blocker.code}>{diverBlockerText(t, diver, blocker)}</li>
              ))}
            </ul>
            <Link
              href={`/shop/${shopSlug}/trips/${tripId}?booking=${diver.bookingId}#booking-${diver.bookingId}`}
              className={undoClass}
            >
              {t("manifest.deck.return")}
            </Link>
          </div>
        ) : (
          control("boarded")
        ),
      undo: !missing && !conflict ? control("cleared") : null,
      details: (
        <>
          {blocked &&
          !missing &&
          !conflict &&
          !diver.notHere &&
          !diver.turnedAway &&
          view.cancelled !== "closed" ? (
            <div className="space-y-3">
              <p>{t("manifest.deck.physicalHint")}</p>
              {control("boarded", true)}
            </div>
          ) : null}
          <DiverRollCall
            context={{
              ...rollCall.divers,
              divers,
            }}
            selectedBookingId={diver.bookingId}
          />
        </>
      ),
    };
  });
  const crewPeople: DeckPerson[] = crew.map((member) => {
    const missing = isNotBackAboard(view.checkpoint, member.rollCall);
    const conflict = member.rollCallContext?.conflict === true;
    const control = (status: "boarded" | "cleared") => (
      <RollCallButton
        key={`${member.id}:${view.checkpoint}:${status}`}
        action={actions.crewRollCall}
        subject={{ field: "personId", id: member.id }}
        status={status}
        retracts={status === "cleared" ? member.rollCall?.eventId : undefined}
        label={t(status === "cleared" ? "manifest.deck.undo" : "manifest.deck.record", {
          name: member.fullName,
        })}
        pendingLabel={t("words.busy.saving")}
        className={status === "cleared" ? undoClass : recordClass}
        copy={rollCall.crew.crewRollCallButtonCopy}
      />
    );
    return {
      id: member.id,
      name: member.fullName,
      photoPath: member.photoPath,
      role: t("manifest.deck.crew"),
      outstanding: !member.rollCall || missing || conflict,
      attention:
        missing || conflict || !!member.recountRequired || view.reader.alerted.has(member.id),
      requiresReview:
        missing || conflict || !!member.recountRequired || view.reader.alerted.has(member.id),
      eventId: member.rollCall?.eventId,
      status: member.rollCall
        ? rollCallLabelText(t, rollCallLabel(view.checkpoint, member.rollCall))
        : member.recountRequired
          ? t("manifest.deck.recountRequired")
          : undefined,
      observed: member.rollCall
        ? t("manifest.deck.observed", {
            time: formatDateTimeTz(
              member.rollCall.occurredAt,
              rollCall.divers.locale,
              rollCall.divers.timezone,
            ),
          })
        : undefined,
      record:
        missing || conflict ? (
          <p className="font-semibold text-danger">{t("manifest.deck.missing")}</p>
        ) : view.cancelled === "closed" ? (
          <p className="font-semibold text-muted">{t("manifest.deck.notCounted")}</p>
        ) : (
          control("boarded")
        ),
      undo: !missing && !conflict ? control("cleared") : null,
      details: (
        <CrewRollCall {...rollCall.crew} crew={crew} divers={divers} selectedPersonId={member.id} />
      ),
    };
  });
  const people = [...guestPeople, ...crewPeople];
  const totalPeople = physicalPeople(divers, crew);
  // Every role still needs its own evidence. A missing/conflicting role keeps
  // that physical person unresolved even when their other role is aboard.
  const outstandingPeople = physicalPeople(
    divers.filter((_diver, index) => guestPeople[index].outstanding),
    crew.filter((_member, index) => crewPeople[index].outstanding),
  );
  return (
    <DeckFlow
      exit={exit}
      key={`${manifest.trip.id}:${view.checkpoint}`}
      people={people}
      copy={deckCopy(t)}
      checkpoint={checkpoint}
      progress={t("manifest.deck.progress", {
        count: totalPeople - outstandingPeople,
        total: totalPeople,
      })}
      complete={manifest.completeness.complete}
      attention={attention}
      details={details}
      status={
        <>
          {status}
          {(manifest.summary.recountRequired ?? 0) > 0 ? (
            <p className="font-semibold text-danger" role="status">
              {t("manifest.recountRequired", { count: manifest.summary.recountRequired ?? 0 })}
            </p>
          ) : null}
          {(manifest.summary.historicalReviewRequired ?? 0) > 0 ? (
            <p className="text-danger" role="status">
              {t("manifest.historicalReviewRequired", { count: manifest.summary.historicalReviewRequired ?? 0 })}
            </p>
          ) : null}
          <MixedTrainingDepthWarning
            show={mixedTrainingDepthAdvisory(
              divers.flatMap((diver) =>
                !diver.identityWithheld && diver.trainingDive ? [diver.trainingDive] : [],
              ),
            )}
            t={t}
          />
        </>
      }
      timeZone={rollCall.divers.timezone}
      locale={rollCall.divers.locale}
      isDeparture={view.isDeparture}
    />
  );
}
