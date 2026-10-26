// i18n-exempt-file: every visible label arrives as an already-translated prop; the session report is data for DiveDay, not copy.
"use client";

import { useState } from "react";
import { Copyable } from "@/components/Copyable";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { buttonClass, tapTargetLinkClass } from "@/components/ui/button";
import { SummaryCaret } from "@/components/ui/disclosure";
import {
  requestDryRun,
  requestExtensionHello,
  requestPadiSession,
  useCertCheckExtensionPresence,
} from "@/components/useCertCheckExtension";
import { fill } from "@/i18n/fill";
import {
  dryRunPassed,
  type ExtensionDryRun,
  type ExtensionHello,
  MIN_EXTENSION_VERSION,
  type PadiSession,
} from "@/lib/cert-check-extension";
import { nowDate } from "@/lib/clock";

export type CertCheckTryCopy = {
  run: string;
  running: string;
  extension: string;
  samples: string;
  padi: string;
  report: string;
  viewReport: string;
  /** A template: `{version}`. */
  added: string;
  notAdded: string;
  /** A template: `{version}` and `{minimum}`. */
  outdated: string;
  passed: string;
  failed: string;
  notListed: string;
  signedIn: string;
  signedOut: string;
  noTab: string;
  noAnswer: string;
  /** PADI's hosts are kept off the extension in this browser. */
  noAccess: string;
  /** A template: `{agency}`. The next step when Chrome keeps the extension off that agency's site. */
  allowSite: string;
  /** The next step beside any other failed sample: send the report. */
  failedNext: string;
  /** The shop's PADI switch is off. */
  padiOff: string;
  /** Under the report: what to do with it. */
  reportHint: string;
  /** The support address's link words ("Email support@dive.day"). */
  email: string;
  copy: string;
  copied: string;
  copyFailed: string;
};

/** What one sample lookup came to: run, not in this copy, or not sent because the extension did not answer. */
type SampleOutcome = { run: ExtensionDryRun } | { notListed: true } | { noAnswer: true };

type Session = {
  hello: ExtensionHello | null;
  samples: Record<string, SampleOutcome>;
  padi: PadiSession | null;
  /** When it ran, and in what browser: the report's own facts, fixed when it ran. */
  at: Date;
  browser: string;
};

/**
 * The session report a staffer copies and sends back: versions, each step's
 * outcome and each sample page's shape (form words only), the browser. Never
 * a diver, a staffer or the shop: the sample diver is made up, and nothing
 * was looked up with any agency. Plain JSON, unwrapped, so it pastes whole.
 */
export function certCheckTryReport(session: Session, installed: string | null): string {
  const samples = Object.fromEntries(
    Object.entries(session.samples).map(([agency, outcome]) => [
      agency,
      "notListed" in outcome
        ? { result: "not_listed" }
        : "noAnswer" in outcome
          ? { result: "no_answer" }
          : outcome.run.ok
            ? {
                result: dryRunPassed(outcome.run) ? "passed" : "failed",
                filled: outcome.run.filled,
                typed: outcome.run.typed,
                submitted: outcome.run.submitted,
                hostAccess: outcome.run.hostAccess,
                missing: outcome.run.missing,
                pageShape: outcome.run.pageShape ?? null,
              }
            : { result: "failed", reason: outcome.run.reason },
    ]),
  );
  return JSON.stringify(
    {
      report: "diveday-cert-check-try",
      at: session.at.toISOString(),
      extension: session.hello?.version ?? installed,
      minimum: MIN_EXTENSION_VERSION,
      agencies: session.hello?.agencies ?? null,
      elearning: session.hello?.elearning ?? null,
      samples,
      padi: session.padi ?? "no_answer",
      browser: session.browser,
    },
    null,
    2,
  );
}

function Step({
  number,
  heading,
  children,
}: {
  number: number;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <li className="grid grid-cols-[2rem_1fr] gap-x-3 py-4">
      <span aria-hidden className="font-semibold tabular-nums text-muted">
        {number}
      </span>
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{heading}</h2>
        <div className="mt-2 text-sm">{children}</div>
      </div>
    </li>
  );
}

/**
 * **Try the checks** (H-105): the extension's own steps, run in this browser
 * against nothing real. The extension is here and current; each agency's
 * sample page (which the extension carries) is found, typed into and sent by
 * the real filler, with a made-up diver, and goes nowhere; and an open PADI
 * Pros' Site tab is read only for whether it is signed in. Each sample also
 * says whether Chrome lets the extension on that agency's own site, without
 * which a real check there fails. A failed step says what to do next, and the
 * report is copied into an email to DiveDay's support address. It is what a
 * staffer runs alone before a first real check, so a broken install shows
 * here and not on a diver.
 */
export function CertCheckTry({
  agencies,
  copy,
  padiOn,
  supportEmail,
}: {
  /** The agencies with a sample page, by key, with their names. PADI has none. */
  agencies: readonly { key: string; name: string }[];
  copy: CertCheckTryCopy;
  /** This shop's "PADI checks (beta)" switch (H-121). */
  padiOn: boolean;
  supportEmail: string;
}) {
  const presence = useCertCheckExtensionPresence();
  const [running, setRunning] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const installed = presence.state === "absent" ? null : presence.version;

  async function run() {
    setRunning(true);
    setSession(null);
    const hello = await requestExtensionHello();
    const samples: Record<string, SampleOutcome> = {};
    // No answer to hello: nothing else would be answered either, so nothing more is sent.
    for (const agency of agencies) {
      samples[agency.key] = !hello
        ? { noAnswer: true }
        : !hello.agencies.includes(agency.key)
          ? { notListed: true }
          : { run: await requestDryRun(agency.key) };
    }
    const padi = hello ? await requestPadiSession() : null;
    setSession({ hello, samples, padi, at: nowDate(), browser: navigator.userAgent });
    setRunning(false);
  }

  const extensionText =
    presence.state === "absent"
      ? copy.notAdded
      : presence.state === "outdated"
        ? fill(copy.outdated, { version: presence.version, minimum: MIN_EXTENSION_VERSION })
        : fill(copy.added, { version: presence.version });
  const badge = (tone: BadgeTone, text: string) => <Badge tone={tone}>{text}</Badge>;
  const padiText: Record<PadiSession, string> = {
    signed_in: copy.signedIn,
    signed_out: copy.signedOut,
    no_tab: copy.noTab,
    no_access: copy.noAccess,
  };
  const next = (text: string) => <p className="basis-full text-muted">{text}</p>;

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={running || presence.state !== "current"}
        aria-busy={running}
        className={buttonClass({ variant: "primary" })}
      >
        {running ? copy.running : copy.run}
      </button>
      {/* Nested-step status alignment (#2887): Extension and PADI badges
          answer their outer steps; sample badges answer each nested agency.
          Its 64px label and 12px gap place that mark 76px deeper. Each pill
          centers its own mark; the outer steps do not share an icon column. */}
      <ol className="mt-4 divide-y divide-border">
        <Step number={1} heading={copy.extension}>
          {presence.state === "current"
            ? badge("success", extensionText)
            : badge("warning", extensionText)}
        </Step>
        <Step number={2} heading={copy.samples}>
          <ul className="space-y-2" aria-label={copy.samples}>
            {agencies.map((agency) => {
              const outcome = session?.samples[agency.key];
              return (
                <li key={agency.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-16 font-medium">{agency.name}</span>
                  {!outcome ? null : "notListed" in outcome ? (
                    badge("neutral", copy.notListed)
                  ) : "noAnswer" in outcome ? (
                    badge("warning", copy.noAnswer)
                  ) : dryRunPassed(outcome.run) ? (
                    badge("success", copy.passed)
                  ) : (
                    <>
                      {badge("danger", copy.failed)}
                      {next(
                        outcome.run.ok && !outcome.run.hostAccess
                          ? fill(copy.allowSite, { agency: agency.name })
                          : copy.failedNext,
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </Step>
        <Step number={3} heading={copy.padi}>
          {padiOn ? null : <p className="mb-2 text-muted">{copy.padiOff}</p>}
          {session ? (
            session.padi ? (
              <>
                {badge(
                  session.padi === "signed_in"
                    ? "success"
                    : session.padi === "no_access"
                      ? "danger"
                      : "neutral",
                  padiText[session.padi],
                )}
                {session.padi === "no_access"
                  ? next(fill(copy.allowSite, { agency: "PADI" }))
                  : null}
              </>
            ) : (
              badge("warning", copy.noAnswer)
            )
          ) : null}
        </Step>
        <Step number={4} heading={copy.report}>
          {session ? (
            <>
              <Copyable
                value={certCheckTryReport(session, installed)}
                layout="inline"
                copyLabel={copy.copy}
                copiedLabel={copy.copied}
                failedLabel={copy.copyFailed}
              />
              <details className="group/report mt-2">
                <summary className="flex min-h-11 cursor-pointer items-center font-medium text-primary">
                  {copy.viewReport}
                  <SummaryCaret className="ms-2 size-3 group-open/report:rotate-90" />
                </summary>
                <pre className="mt-2 whitespace-pre-wrap wrap-anywhere rounded-inset bg-surface-sunken p-3 text-xs">
                  {certCheckTryReport(session, installed)}
                </pre>
              </details>
              <p className="mt-2 text-muted">{copy.reportHint}</p>
              <a
                href={`mailto:${supportEmail}`}
                className={`${tapTargetLinkClass} font-medium text-primary hover:underline`}
              >
                {copy.email}
              </a>
            </>
          ) : null}
        </Step>
      </ol>
    </div>
  );
}
