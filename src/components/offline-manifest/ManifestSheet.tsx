import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { BoatSafetyNotices } from "@/components/BoatSafetyNotices";
import { EmergencyReferenceCard } from "@/components/EmergencyReferenceCard";
import { AutoPrint } from "@/components/paper/AutoPrint";
import { PaperSheet, SheetMark } from "@/components/paper/PaperSheet";
import { buttonClass } from "@/components/ui/button";
import { ITEM_TITLE_CLASS } from "@/components/ui/typography";
import { rollCallCheckpointText, rollCallLabelText } from "@/i18n/manifest-labels";
import { staffSoulsOnBoardLine } from "@/i18n/staff-participant-labels";
import { nowDate } from "@/lib/clock";
import { EMPTY_EMERGENCY_REFERENCE } from "@/lib/emergency-reference";
import { formatDateTimeTz } from "@/lib/format";
import { rollCallCheckpointOrdinal, rollCallLabel, rollCallRowState } from "@/lib/manifests";
import { isOfflineManifestExpired, type OfflineRollCallResult } from "@/lib/offline-manifests";
import { PACKET_PAPER, storefrontAddress } from "@/lib/print-sheets";
import type { OfflineTripControls } from "./controls";
import { offlineDiverFactLines, offlineDiverRowFacts } from "./diver-row-facts";
import { buddyNamesList } from "./shared";
import type { OfflineTripView } from "./trip-view";

/**
 * The saved copy's band. The copy carries no brand colour, so the sheet
 * wears DiveDay's own, as a shop that never chose one does.
 */

/** How often an open sheet asks whether its copy has expired under it. */
export const SHEET_EXPIRY_CHECK_MS = 15_000;

/** One empty box to tick per checkpoint: paper outlives the phone it came from. */
function CheckpointBoxes({ labels }: { labels: readonly string[] }) {
  return (
    <p data-sheet-boxes="" className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
      {labels.map((label) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block size-4 border border-border-strong" />
          {label}
        </span>
      ))}
    </p>
  );
}

/**
 * **The saved copy's paper face** (issue #2745): the offline manifest at the
 * checkpoint on screen, as one sheet, the paper a crew boards from when the
 * phone is the only copy (the fallback boarding source).
 *
 * A state of the offline page, never a second page: it draws from the same
 * decrypted copy and the same view, with no network, and the screen is gone
 * while it shows, so nothing that taps prints and nothing printed taps. Every
 * row's words are the roll-call row's own (`offlineDiverRowFacts`), so the
 * sheet cannot say something the phone does not, and it restates what the
 * live printed manifest restates: gear and nitrox, every medical sentence,
 * the lunch note, persons on board, the boat's safety lines, and a box to
 * tick per checkpoint.
 *
 * **Expiry holds at print time, not at the door** (layer 7 review D1): every
 * print, the door's or the browser's, asks the clock first, and an open
 * sheet asks on a timer; a copy that has expired drops back to the screen,
 * which never prints. The sheet says when it stops being a boarding source,
 * and the fold line says when it was printed, read as it prints.
 *
 * **What it never prints**: a medical alert's words, whatever this phone
 * holds. Paper with them on it is the medical-alerts packet's job, which a
 * permitted reader prints with signal and which records who printed it; a
 * row says an alert exists, and the sheet says where to read it. A held
 * seat prints as the row on the phone does: why it is withheld, and the
 * desk's contact for it, never the matched person's particulars.
 */
export function OfflineManifestSheet({
  view,
  controls,
  origin,
  onBack,
  autoPrint = true,
}: {
  view: OfflineTripView;
  controls: Pick<OfflineTripControls, "t" | "locale" | "copyCaveat">;
  /** The app's origin, read by the door, for the fold's storefront address. */
  origin: string | null;
  /** Back to the screen: the crew's door, and where an expired copy goes. */
  onBack: () => void;
  /** Opens the print dialog on arrival; the door that opened this said Print. */
  autoPrint?: boolean;
}) {
  const { t, locale } = controls;
  const { envelope, manifest, checkpoint } = view;
  const { shop } = envelope.snapshot;
  const [printedAt, setPrintedAt] = useState(() => nowDate());
  // Who recorded a saved state and when, zone named, as the live printed row
  // says it (`DiverRowPrint`). A tap queued on this device has no name to
  // print, and an implied reading nobody recorded.
  const recordedLine = (state: OfflineRollCallResult | undefined) =>
    state?.recordedByName && !state.implied ? (
      <p data-sheet-recorded="">
        {t("manifest.rollCallRecordedByPlain", {
          label: rollCallLabelText(t, rollCallLabel(checkpoint, state)),
          date: formatDateTimeTz(new Date(state.occurredAt), locale, shop.timezone),
          name: state.recordedByName,
        })}
      </p>
    ) : null;

  useEffect(() => {
    const expired = () => isOfflineManifestExpired(envelope.snapshot, nowDate());
    // `flushSync`: the browser takes its picture of the page as soon as this
    // returns, so the screen (or the new time) must already be drawn.
    const beforePrint = () => {
      if (expired()) flushSync(onBack);
      else flushSync(() => setPrintedAt(nowDate()));
    };
    window.addEventListener("beforeprint", beforePrint);
    const timer = window.setInterval(() => {
      if (expired()) onBack();
    }, SHEET_EXPIRY_CHECK_MS);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.clearInterval(timer);
    };
  }, [envelope.snapshot, onBack]);

  const rows = manifest.divers.map((diver, index) => {
    const facts = offlineDiverRowFacts(diver, index, view, controls);
    return { diver, facts, lines: offlineDiverFactLines(diver, facts, controls) };
  });
  const anyMedicalAlert = rows.some(({ diver, facts }) => diver.medicalAlert && !facts.withheld);
  const boxLabels = envelope.snapshot.manifests
    .map((entry) => entry.checkpoint)
    .sort((a, b) => rollCallCheckpointOrdinal(a) - rollCallCheckpointOrdinal(b))
    .map((entry) => rollCallCheckpointText(t, entry));

  return (
    <main className="w-full flex-1 bg-background">
      {autoPrint ? <AutoPrint /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          {t("shared.offlineManifest.sheet.back")}
        </button>
        <button
          type="button"
          onClick={() => {
            if (isOfflineManifestExpired(envelope.snapshot, nowDate())) {
              onBack();
              return;
            }
            window.print();
          }}
          className={buttonClass({ variant: "secondary" })}
        >
          {t("shared.offlineManifest.sheet.print")}
        </button>
      </div>
      <div className="paper-sheet-frame">
        <div>
          <PaperSheet
            paper={PACKET_PAPER}
            lang={locale}
            band={
              <>
                <SheetMark name={shop.name} size="sm" />
                <span className="font-brand-display text-sm font-bold">{shop.name}</span>
                <span className="ms-auto text-sm font-semibold">
                  {t("shared.offlineManifest.sheet.name")}
                </span>
              </>
            }
            foldLeft={t("shared.offlineManifest.sheet.printed", {
              date: formatDateTimeTz(printedAt, locale, shop.timezone),
            })}
            foldRight={storefrontAddress(shop.slug, origin)}
          >
            <div data-offline-manifest-sheet="" className="grid gap-4 text-sm">
              <header>
                <h1 className={ITEM_TITLE_CLASS}>{manifest.trip.title}</h1>
                <p className="font-semibold">
                  {formatDateTimeTz(new Date(manifest.trip.startsAt), locale, shop.timezone)}
                  {" · "}
                  {t("shared.offlineManifest.single.checkpointRollCallHeading", {
                    checkpoint: rollCallCheckpointText(t, checkpoint),
                  })}
                </p>
                {/* How old this paper is, before anyone reads a name off it. */}
                <p className="mt-1 font-semibold">
                  {t(
                    controls.copyCaveat === "offline"
                      ? "shared.offlineManifest.single.copyCaveatOffline"
                      : controls.copyCaveat === "unanswered"
                        ? "shared.offlineManifest.single.copyCaveatUnanswered"
                        : "shared.offlineManifest.single.copyCaveatOnline",
                    { when: view.savedAtZoned },
                  )}
                </p>
                {/* And when it stops being one: paper outlives the copy. */}
                <p data-sheet-expires="" className="mt-1 font-bold">
                  {t("shared.offlineManifest.sheet.expires", {
                    when: formatDateTimeTz(
                      new Date(envelope.snapshot.expiresAt),
                      locale,
                      shop.timezone,
                    ),
                  })}
                </p>
                <p data-sheet-souls="" className="mt-1 font-semibold tabular-nums">
                  {staffSoulsOnBoardLine(
                    t,
                    { totalDivers: view.totalDivers },
                    view.crewAssigned,
                    view.physicalTotal,
                  )}
                </p>
                <p className="tabular-nums">
                  {[
                    `${t("shared.offlineManifest.single.statsBoarded")} ${view.boarded}`,
                    `${t("shared.offlineManifest.single.statsAwaiting")} ${view.awaiting}`,
                  ].join(" · ")}
                </p>
                {view.overTotalPersons ? (
                  <p data-sheet-over-capacity="" className="mt-1 font-bold text-danger">
                    {t("manifest.headCountOverTotalPersonsAboard", view.overTotalPersons)}
                  </p>
                ) : null}
              </header>

              <EmergencyReferenceCard
                reference={shop.emergencyReference ?? EMPTY_EMERGENCY_REFERENCE}
                copy={{
                  heading: t("manifest.emergency.heading"),
                  empty: t("manifest.emergency.empty"),
                  vesselLabel: t("manifest.emergency.vesselLabel"),
                  callSignLabel: t("manifest.emergency.callSignLabel"),
                  mmsiLabel: t("manifest.emergency.mmsiLabel"),
                  workingChannelLabel: t("manifest.emergency.workingChannelLabel"),
                  distressChannel: t("manifest.emergency.distressChannel"),
                  shoreContactLabel: t("manifest.emergency.shoreContactLabel"),
                  planLabel: t("manifest.emergency.planLabel"),
                }}
              />

              {envelope.snapshot.boatSafety ? (
                <BoatSafetyNotices {...envelope.snapshot.boatSafety} />
              ) : null}

              {anyMedicalAlert ? (
                <p className="font-semibold">
                  {t("shared.offlineManifest.sheet.medicalAlertWords")}
                </p>
              ) : null}

              <ol data-sheet-roster="" className="divide-y divide-border border-y border-border">
                {rows.map(({ diver, facts, lines }, index) => (
                  <li
                    key={diver.bookingId}
                    data-sheet-row={diver.bookingId}
                    data-print-critical={facts.missing || facts.blockedAtDock ? "" : undefined}
                    className="break-inside-avoid py-2"
                  >
                    <p className="text-base font-bold">
                      <span className="me-2 tabular-nums">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {diver.fullName}
                    </p>
                    <p
                      className={`font-semibold ${
                        facts.missing || facts.blockedAtDock ? "text-danger" : ""
                      }`}
                    >
                      {facts.statusLine}
                    </p>
                    {!facts.withheld && diver.safetyAdvisoryText ? (
                      <p className="text-warning-strong">{diver.safetyAdvisoryText}</p>
                    ) : null}
                    {lines.medical.map((line) => (
                      <p key={line} className="font-medium text-warning-strong">
                        {line}
                      </p>
                    ))}
                    {recordedLine(facts.state)}
                    {facts.state?.note ? <p className="break-words">{facts.state.note}</p> : null}
                    {diver.buddyTeamNames && diver.buddyTeamNames.length > 0 ? (
                      <p>
                        {t("shared.buddyTeam.with", {
                          names: buddyNamesList(locale, diver.buddyTeamNames),
                        })}
                      </p>
                    ) : null}
                    {lines.gear.map((line) => (
                      <p key={line} className="font-semibold">
                        {line}
                      </p>
                    ))}
                    {facts.withheld ? (
                      <>
                        <p className="paper-sheet-muted">{t("manifest.identityWithheldDetails")}</p>
                        {diver.identityWithheld && diver.heldEmergencyContact ? (
                          <p>
                            {`${t("manifest.heldEmergencyContactLabel")}: ${diver.heldEmergencyContact.name} · ${diver.heldEmergencyContact.phone}`}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p>
                        {`${t("shared.offlineManifest.single.emergencyContact")}: ${
                          diver.emergencyContactName && diver.emergencyContactPhone
                            ? `${diver.emergencyContactName} · ${diver.emergencyContactPhone}`
                            : t("shared.offlineManifest.single.notOnFile")
                        }`}
                      </p>
                    )}
                    {lines.other.map((line) => (
                      <p key={line} className="break-words">
                        {line}
                      </p>
                    ))}
                    <CheckpointBoxes labels={boxLabels} />
                  </li>
                ))}
              </ol>

              <section>
                <h2 className="text-base font-bold">
                  {t("shared.offlineManifest.single.crewHeading")}
                </h2>
                {view.crewWithKeys.length > 0 ? (
                  <ul data-sheet-crew="" className="mt-1 grid gap-2">
                    {view.crewWithKeys.map((member) => (
                      <li
                        key={member.key}
                        data-print-critical={
                          rollCallRowState(checkpoint, member.state).notBackAboard ? "" : undefined
                        }
                        className="break-inside-avoid"
                      >
                        <span className="font-bold">{member.fullName}</span>
                        {" · "}
                        {rollCallLabelText(t, rollCallLabel(checkpoint, member.state))}
                        {member.state?.pending
                          ? ` ${t("shared.offlineManifest.single.statePendingSuffix")}`
                          : ""}
                        {recordedLine(member.state)}
                        <CheckpointBoxes labels={boxLabels} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t("shared.offlineManifest.single.crewNoneAssigned")}</p>
                )}
              </section>
            </div>
          </PaperSheet>
        </div>
      </div>
    </main>
  );
}
