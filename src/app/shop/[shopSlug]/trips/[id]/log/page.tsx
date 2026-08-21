import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AGENCY_KEYS } from "@/app/shop/[shopSlug]/divers/[personId]/_components/shared";
import { PrintButton } from "@/components/PrintButton";
import { ShopStat } from "@/components/ShopPageHeader";
import { buttonClass } from "@/components/ui/button";
import { sectionCardClass } from "@/components/ui/card";
import { Table, TBody, Td, THead, Th } from "@/components/ui/table";
import { canPersonExportIncidentRecord } from "@/db/authz";
import { getIncidentExport } from "@/db/incident-export";
import { rollCallCheckpointText, rollCallLabelText } from "@/i18n/manifest-labels";
import { CERTIFICATION_LEVEL_KEYS, SPECIALTY_KEYS } from "@/i18n/readiness-labels";
import { requestLocale } from "@/i18n/request";
import { type StaffMessageKey, type StaffTranslator, staffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate } from "@/lib/calendar-date";
import {
  formatDateTimeTz,
  formatShortDate,
  formatTimeRangeTz,
  formatTimeZoneName,
} from "@/lib/format";
import type {
  IncidentCertificationEvidence,
  IncidentRollCallResult,
  IncidentWaiverStatus,
} from "@/lib/incident-export";
import { cachedListFormat } from "@/lib/intl-cache";
import type { RollCallCheckpoint } from "@/lib/manifests";
import type { CertificationLevel } from "@/lib/readiness";
import { requireShopSurface } from "@/lib/session";
import { noticeUrl, shopPath } from "@/lib/staff-notices";
import { uuidParam } from "@/lib/uuid";

// `instant = true` asserts that navigating *into* this page paints
// immediately — the claim every trips/[id] sibling makes (ADR
// 20260804-instant-navigation): arriving from close-out, the staff shell is
// already mounted and this segment's `loading.tsx` is what paints while the
// document assembles.
export const instant = true;

export const metadata: Metadata = {
  title: "Departure log — DiveDay",
};

/**
 * What each act on a buddy team reads as in the timeline. Codes come from
 * `src/lib/incident-export.ts`; the words live here, like every other status
 * this page prints.
 */
const BUDDY_TEAM_ACTION_KEYS: Record<
  "formed" | "dissolved" | "member_added" | "member_removed",
  StaffMessageKey
> = {
  formed: "incidentExport.timelineBuddyFormed",
  dissolved: "incidentExport.timelineBuddyDissolved",
  member_added: "incidentExport.timelineBuddyMemberAdded",
  member_removed: "incidentExport.timelineBuddyMemberRemoved",
};

/**
 * One departure's log: recorded facts only — boarding, the append-only
 * roll-call timeline, certification evidence as held, waiver *status* (never
 * medical answers) — each with its timestamp and recorder, plus a SHA-256
 * integrity code in the footer so a printout can be checked against a fresh
 * one. It is what a shop hands to authorities or insurers if a departure is
 * ever asked about.
 *
 * **Generated from close-out, not from the manifest.** It used to sit in the
 * manifest header, which is the surface a crew works *during* a departure —
 * an "incident-ready export" button beside "Mark boarded" reads as something
 * the day might need, on a page nobody should be reading prose on. Writing the
 * day's log is an evening act, so its door is the evening surface (ADR
 * 20260804-day-closeout), one row per departure, beside the recap note.
 *
 * **Owner-only** (`canExportIncidentRecord`, src/lib/authz.ts), unlike the
 * manifest and the close-out page it is reached from: the crew run the roll
 * call, but producing the shop's account of a departure — and having their own
 * name stamped on it as its generator — is the owner's call. Read-only:
 * nothing on this page mutates anything. Print-first: chrome is
 * `print:hidden`, everything else is plain bordered tables the `@media print`
 * monochrome treatment already handles (globals.css).
 */
export default async function IncidentExportPage({
  params,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
}) {
  const { shopSlug, id: tripId } = await params;
  // An unparseable id names no row. Guarded here rather than in the query
  // helper: comparing junk against a `uuid` column raises in Postgres, so
  // without this the page 500s where its own notFound() belongs.
  if (!uuidParam(tripId)) notFound();
  const { session, db, shop } = await requireShopSurface(shopSlug);
  const locale = await requestLocale(shop.defaultLocale);
  const t = staffTranslator(locale);
  // Checked against the database, not the JWT, so a demoted owner loses this
  // immediately. Close-out hides the link for everyone else, but this is the
  // gate — the page refuses however it was reached. The landing is close-out
  // with a reason on it: a refusal that teleports you somewhere silently reads
  // as a broken button (task 82).
  if (!(await canPersonExportIncidentRecord(db, shop.id, session.user.personId))) {
    redirect(noticeUrl(shopPath(shopSlug, "close-out"), "log-not-authorized"));
  }
  // Tenancy is the session's shop, never the URL: another shop's trip id — or
  // a stale slug — resolves to null and 404s.
  const doc = await getIncidentExport(db, shop.id, tripId, session.user.personId);
  if (!doc) notFound();

  const dateTime = (isoString: string) =>
    formatDateTimeTz(new Date(isoString), locale, doc.meta.timezone);
  const checkpointText = (checkpoint: string) =>
    rollCallCheckpointText(t, checkpoint as RollCallCheckpoint);
  // The trail's names join in the reader's own locale, never a hard-coded ", ".
  const memberList = cachedListFormat(locale, { type: "conjunction" });
  const agencyText = (agency: string) =>
    t(AGENCY_KEYS[agency as keyof typeof AGENCY_KEYS] ?? AGENCY_KEYS.other);
  const roleKey: Record<string, StaffMessageKey> = {
    owner: "settings.team.roleLabels.owner",
    manager: "settings.team.roleLabels.manager",
    instructor: "settings.team.roleLabels.instructor",
    divemaster: "settings.team.roleLabels.divemaster",
    captain: "settings.team.roleLabels.captain",
    crew: "settings.team.roleLabels.crew",
  };

  const summary: [string, number][] = [
    [t("incidentExport.summaryDivers"), doc.departureSummary.totalDivers],
    [t("incidentExport.summaryBoarded"), doc.departureSummary.boarded],
    [t("incidentExport.summaryNotBoarded"), doc.departureSummary.notBoarded],
    [t("incidentExport.summaryAwaiting"), doc.departureSummary.awaiting],
    [t("incidentExport.summaryCrewAssigned"), doc.departureSummary.crewAssigned],
  ];

  return (
    <div>
      <header className="border-b border-border pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">
              {t("incidentExport.title")}
            </p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{doc.meta.tripTitle}</h1>
            <p className="mt-1 text-muted">
              {formatShortDate(new Date(doc.meta.tripStartsAt), locale, doc.meta.timezone)} ·{" "}
              {formatTimeRangeTz(
                new Date(doc.meta.tripStartsAt),
                new Date(doc.meta.tripEndsAt),
                locale,
                doc.meta.timezone,
              )}{" "}
              · {doc.meta.shopName}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3 print:hidden">
            <Link
              href={shopPath(shopSlug, "close-out")}
              className={buttonClass({ variant: "ghost" })}
            >
              {t("incidentExport.backToCloseOut")}
            </Link>
            <PrintButton label={t("shared.printButton.label")} />
          </div>
        </div>
        <p className="mt-3 max-w-prose text-sm text-muted">{t("incidentExport.description")}</p>
        <p className="mt-2 max-w-prose text-sm font-semibold">{t("incidentExport.factsOnly")}</p>
        <p className="mt-2 text-sm text-muted">
          {t("incidentExport.generatedLine", {
            date: dateTime(doc.meta.generatedAt),
            name: doc.meta.generatedByName,
          })}{" "}
          ·{" "}
          {t("incidentExport.shopTimeLabel", {
            timezone: formatTimeZoneName(locale, doc.meta.timezone),
          })}
        </p>
      </header>

      <section className="mt-7" aria-labelledby="incident-summary-heading">
        <h2 id="incident-summary-heading" className="text-lg font-semibold">
          {t("incidentExport.summaryHeading")}
        </h2>
        {/* A <dl>, deliberately: this is the definition-list half of the
            "table-and-definition-list document" the a11y scan expects, so a
            screen reader keeps the label-to-figure pairing on the record a
            shop hands an insurer. */}
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {summary.map(([label, value]) => (
            <ShopStat key={label} definition label={label} value={value} />
          ))}
        </dl>
      </section>

      <section className="mt-8" aria-labelledby="incident-roster-heading">
        <h2 id="incident-roster-heading" className="text-lg font-semibold">
          {t("incidentExport.rosterHeading")}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          {t("incidentExport.rosterDescription")}
        </p>
        <Table minWidth="40rem" shellClassName="mt-3">
          <THead>
            <Th>{t("incidentExport.colDiver")}</Th>
            <Th>{t("incidentExport.colEmergencyContact")}</Th>
            <Th>{t("incidentExport.colBuddy")}</Th>
            {doc.meta.checkpoints.map((checkpoint) => (
              <Th key={checkpoint}>{checkpointText(checkpoint)}</Th>
            ))}
          </THead>
          <TBody>
            {doc.roster.map((diver, index) => (
              <tr key={diver.bookingId}>
                <Td>
                  <span className="font-semibold">
                    {String(index + 1).padStart(2, "0")} {diver.fullName}
                  </span>
                </Td>
                <Td muted>
                  {diver.emergencyContactName && diver.emergencyContactPhone
                    ? `${diver.emergencyContactName} · ${diver.emergencyContactPhone}`
                    : t("incidentExport.notOnFile")}
                </Td>
                <Td muted>
                  {diver.buddy ? (
                    <>
                      <span className="font-medium text-foreground">
                        {t("incidentExport.buddyTeam", { number: diver.buddy.teamNumber })}
                      </span>{" "}
                      {/* Every other member, and crew marked as crew — the
                            distinction this document exists to keep, since
                            "accompanied by a divemaster" and "nobody paired
                            them" used to print the same. */}
                      {memberList.format(
                        diver.buddy.members.map((member) =>
                          member.isCrew
                            ? `${member.fullName} (${t("incidentExport.buddyCrewTag")})`
                            : member.fullName,
                        ),
                      )}
                      <span className="block text-xs">
                        {diver.buddy.pairedByName && diver.buddy.pairedAt
                          ? t("incidentExport.buddyPairedBy", {
                              name: diver.buddy.pairedByName,
                              at: dateTime(diver.buddy.pairedAt),
                            })
                          : t("incidentExport.buddyPairedByUnknown")}
                      </span>
                    </>
                  ) : (
                    t("incidentExport.noBuddyRecorded")
                  )}
                </Td>
                {diver.rollCall.map((result) => (
                  <RollCallCell key={result.checkpoint} t={t} result={result} dateTime={dateTime} />
                ))}
              </tr>
            ))}
          </TBody>
        </Table>
      </section>

      <section className="mt-8" aria-labelledby="incident-crew-heading">
        <h2 id="incident-crew-heading" className="text-lg font-semibold">
          {t("incidentExport.crewHeading")}
        </h2>
        {doc.crew.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{t("incidentExport.crewNone")}</p>
        ) : (
          <Table minWidth="40rem" shellClassName="mt-3">
            <THead>
              <Th>{t("incidentExport.colCrewMember")}</Th>
              <Th>{t("incidentExport.colRoles")}</Th>
              <Th>{t("incidentExport.colCrewTeams")}</Th>
              {doc.meta.checkpoints.map((checkpoint) => (
                <Th key={checkpoint}>{checkpointText(checkpoint)}</Th>
              ))}
            </THead>
            <TBody>
              {doc.crew.map((member, index) => (
                <tr
                  // Two crew can share a full name, and the document carries
                  // no person id on purpose (the hash covers printed facts
                  // only). Static list, never reordered.
                  // biome-ignore lint/suspicious/noArrayIndexKey: static, never reordered
                  key={index}
                >
                  <Td className="font-semibold">{member.fullName}</Td>
                  <Td muted>
                    {member.roles
                      .map((role) => (roleKey[role] ? t(roleKey[role]) : role))
                      .join(", ")}
                  </Td>
                  {/* Plural on purpose: one divemaster commonly leads
                      several groups on one boat, and this document must
                      print all of them (ADR 20260804-buddy-teams). */}
                  <Td muted>
                    {member.buddyTeamNumbers.length === 0
                      ? t("incidentExport.crewNoTeams")
                      : member.buddyTeamNumbers
                          .map((number) => t("incidentExport.buddyTeam", { number }))
                          .join(", ")}
                  </Td>
                  {member.rollCall.map((result) => (
                    <RollCallCell
                      key={result.checkpoint}
                      t={t}
                      result={result}
                      dateTime={dateTime}
                    />
                  ))}
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </section>

      <section className="mt-8" aria-labelledby="incident-evidence-heading">
        <h2 id="incident-evidence-heading" className="text-lg font-semibold">
          {t("incidentExport.evidenceHeading")}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          {t("incidentExport.evidenceDescription")}
        </p>
        <ul
          className={sectionCardClass({
            padding: "none",
            className: "mt-3 divide-y divide-border",
          })}
        >
          {doc.roster.map((diver) => (
            <li key={diver.bookingId} className="break-inside-avoid px-4 py-3">
              <p className="font-semibold">{diver.fullName}</p>
              <p className="mt-1 text-sm">
                <WaiverLine t={t} waiver={diver.waiver} dateTime={dateTime} />
              </p>
              {diver.certifications.length === 0 ? (
                <p className="mt-1 text-sm text-muted">{t("incidentExport.certNone")}</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-1 text-sm text-muted">
                  {diver.certifications.map((card) => (
                    // Specialty belongs in the key: a PADI diver's Deep and
                    // Wreck cards carry the same PADI number (see the unique
                    // index note on specialty_certifications in schema.ts).
                    <li
                      key={`${card.kind}-${card.agency}-${card.level}-${card.specialty}-${card.identifier}`}
                    >
                      <CertificationLine
                        t={t}
                        card={card}
                        agencyText={agencyText}
                        dateTime={dateTime}
                        locale={locale}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="incident-timeline-heading">
        <h2 id="incident-timeline-heading" className="text-lg font-semibold">
          {t("incidentExport.timelineHeading")}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted">
          {t("incidentExport.timelineDescription")}
        </p>
        {doc.timeline.length === 0 ? (
          <p className="mt-3 text-sm font-semibold">{t("incidentExport.timelineEmpty")}</p>
        ) : (
          <ol
            className={sectionCardClass({
              padding: "none",
              className: "mt-3 divide-y divide-border",
            })}
          >
            {doc.timeline.map((entry, index) => (
              <li
                // Append-only history has no natural key; index order is the record.
                // biome-ignore lint/suspicious/noArrayIndexKey: static, never reordered
                key={index}
                className="break-inside-avoid flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
              >
                <span className="font-mono text-xs text-muted tabular-nums">
                  {dateTime(entry.occurredAt)}
                </span>
                {entry.checkpoint === null ? null : (
                  <span className="text-muted">{checkpointText(entry.checkpoint)}</span>
                )}
                {entry.kind === "buddy_team" ? (
                  <span className="font-semibold">
                    {entry.teamNumber > 0
                      ? t("incidentExport.buddyTeam", { number: entry.teamNumber })
                      : t("incidentExport.buddyTeamUnnumbered")}{" "}
                    — {t(BUDDY_TEAM_ACTION_KEYS[entry.action])}
                  </span>
                ) : (
                  <span className="font-semibold">
                    {entry.subjectName}
                    {entry.kind === "crew" ? ` (${t("incidentExport.crewTag")})` : ""} —{" "}
                    {entry.action === "cleared"
                      ? t("incidentExport.actionCleared")
                      : rollCallLabelText(
                          t,
                          entry.action === "boarded"
                            ? "boarded"
                            : entry.checkpoint === "departure"
                              ? "not_boarded"
                              : "not_back_aboard",
                        )}
                  </span>
                )}
                <span className="text-muted">
                  {t("incidentExport.recordedByName", { name: entry.recordedByName })}
                </span>
                {entry.kind === "buddy_team" ? (
                  <span className="text-muted">
                    {t("incidentExport.timelineBuddyMembers", {
                      names: memberList.format(entry.memberNames),
                    })}
                  </span>
                ) : null}
                {(entry.kind === "diver" || entry.kind === "crew") && entry.source === "offline" ? (
                  <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-muted">
                    {t("incidentExport.timelineOfflineTag")}
                  </span>
                ) : null}
                {entry.note ? (
                  <span className="text-muted">
                    {t("incidentExport.noteLine", { note: entry.note })}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="mt-10 break-inside-avoid border-t border-border pt-4 text-sm">
        <p className="font-semibold">{t("incidentExport.footerHashLabel")}</p>
        <p className="mt-1 font-mono text-xs break-all">{doc.contentHash}</p>
        <p className="mt-2 max-w-prose text-muted">{t("incidentExport.footerHashExplainer")}</p>
      </footer>
    </div>
  );
}

/** One roll-call result cell: the manifest's own word, plus when and by whom. */
function RollCallCell({
  t,
  result,
  dateTime,
}: {
  t: StaffTranslator;
  result: IncidentRollCallResult;
  dateTime: (isoString: string) => string;
}) {
  return (
    <Td>
      <span
        className={
          result.label === "not_back_aboard"
            ? "font-bold text-danger"
            : result.label === "awaiting"
              ? "text-muted"
              : "font-medium"
        }
      >
        {rollCallLabelText(t, result.label)}
      </span>
      {result.occurredAt && result.recordedByName ? (
        <span className="mt-0.5 block text-xs text-muted">
          {t("incidentExport.resultRecordedBy", {
            date: dateTime(result.occurredAt),
            name: result.recordedByName,
          })}
        </span>
      ) : null}
      {result.note ? (
        <span className="mt-0.5 block text-xs text-muted">
          {t("incidentExport.noteLine", { note: result.note })}
        </span>
      ) : null}
    </Td>
  );
}

/** The waiver *status* line — state, date, template version. Never the answers. */
function WaiverLine({
  t,
  waiver,
  dateTime,
}: {
  t: StaffTranslator;
  waiver: IncidentWaiverStatus;
  dateTime: (isoString: string) => string;
}) {
  if (waiver.state === "complete" && waiver.signedAt) {
    const method =
      waiver.signatureMethod === "imported"
        ? ` ${t("incidentExport.waiverCompleteImported")}`
        : waiver.signatureMethod === "in_person_attested"
          ? ` ${
              waiver.recordedByName
                ? t("incidentExport.waiverPaperMarkedBy", { name: waiver.recordedByName })
                : t("incidentExport.waiverCompleteAttested")
            }`
          : waiver.signatureMethod === "in_person"
            ? ` ${
                waiver.recordedByName
                  ? t("incidentExport.waiverPaperMarkedBy", { name: waiver.recordedByName })
                  : t("incidentExport.waiverCompleteAttested")
              }`
            : "";
    return (
      <>
        {t("incidentExport.waiverComplete", {
          date: dateTime(waiver.signedAt),
          title: waiver.templateTitle ?? "",
          version: waiver.templateVersion ?? 0,
        })}
        {method}
      </>
    );
  }
  if (waiver.state === "medical_review") {
    return <>{t("incidentExport.waiverMedicalReview")}</>;
  }
  if (waiver.state === "awaiting_signature") {
    return <>{t("incidentExport.waiverPending")}</>;
  }
  if (waiver.state === "expired") {
    return <>{t("incidentExport.waiverExpired")}</>;
  }
  return <>{t("incidentExport.waiverNotSigned")}</>;
}

/** One held card, as the shop's records state it. */
function CertificationLine({
  t,
  card,
  agencyText,
  dateTime,
  locale,
}: {
  t: StaffTranslator;
  card: IncidentCertificationEvidence;
  agencyText: (agency: string) => string;
  dateTime: (isoString: string) => string;
  locale: string;
}) {
  const levelKey = card.level
    ? CERTIFICATION_LEVEL_KEYS[card.level as CertificationLevel]
    : undefined;
  const specialtyKey = card.specialty
    ? SPECIALTY_KEYS[card.specialty as keyof typeof SPECIALTY_KEYS]
    : undefined;
  // A self-declared card has no number, and "absence is stated, never blank" is
  // rule 2 of this document (src/lib/incident-export.ts) — a bare gap where a
  // card number belongs reads as a missing page to an investigator.
  const identifier = card.identifier ?? t("incidentExport.certNoNumber");
  const line =
    card.kind === "level" && levelKey
      ? t("incidentExport.certLevelLine", {
          agency: agencyText(card.agency),
          level: t(levelKey),
          identifier,
        })
      : card.kind === "specialty" && specialtyKey
        ? t("incidentExport.certSpecialtyLine", {
            agency: agencyText(card.agency),
            specialty: t(specialtyKey),
            identifier,
          })
        : t("incidentExport.certNitroxLine", {
            agency: agencyText(card.agency),
            identifier,
          });
  const status =
    card.status === "verified"
      ? card.reviewedAt
        ? card.reviewedByName
          ? t("incidentExport.certStatusVerifiedBy", {
              date: dateTime(card.reviewedAt),
              name: card.reviewedByName,
            })
          : t("incidentExport.certStatusVerifiedUnknownReviewer", {
              date: dateTime(card.reviewedAt),
            })
        : t("incidentExport.certStatusVerifiedNoDate")
      : t("incidentExport.certStatusPending");
  return (
    <>
      {line} · {status}
      {card.imported ? <> · {t("incidentExport.certImportedTag")}</> : null}
      {/* The weakest thing on the page, and it has to read that way. */}
      {card.selfDeclared ? <> · {t("incidentExport.certSelfDeclaredTag")}</> : null}
      {card.expiresAt ? (
        <>
          {" "}
          ·{" "}
          {t("incidentExport.certRefresherDue", {
            // Date-only value: formatted as a calendar date, never through a
            // timezone conversion that could shift the printed day (CR-009).
            date: formatCalendarDate(card.expiresAt, locale),
          })}
        </>
      ) : null}
    </>
  );
}
