import { createHash } from "node:crypto";

/**
 * The pure half of the weekly persona walk (N-61): what a finding is called,
 * whether it has been reported before, how many may be filed at all, and how
 * the run is written up. Nothing here touches a browser, a server or GitHub —
 * `walk.spec.ts` does the walking and `scripts/persona-bots-file.mjs` does the
 * filing, and both hand their facts to this module so `lib.test.mjs` can pin
 * the judgement.
 *
 * **The volume policy is the feature.** Fifteen personas over forty-five stops
 * with eight lenses each can see a great deal on any given Tuesday, and the
 * tracker it writes into is one person's inbox. So three rules stand between a
 * walk and the tracker, and each is a number in `FILING_LIMITS`:
 *
 * 1. **A finding is a fingerprint, not an event.** The same defect seen on ten
 *    runs is one issue. The fingerprint is deliberately coarse — persona, lens,
 *    stop, and the *shape* of the evidence with every id, number and origin
 *    normalised out — because a fingerprint that changed when a uuid did would
 *    file the same defect every week under a new name.
 * 2. **A run may file very few, and never more than one per persona.** Which
 *    few is decided by lens severity, so the week a page renders blank that is
 *    what lands, not four tap targets.
 * 3. **A full inbox stops the filing entirely.** While `inboxCeiling` persona
 *    issues are open and untriaged, a run files nothing new at all and says so.
 *    This is the rule that bounds the steady state: the tracker can hold at
 *    most that many of these at once, however long the run goes on finding
 *    things.
 *
 * What the caps must never do is go quiet. Every run writes a summary naming
 * what it suppressed and why, because a capped run that printed nothing would
 * read as a clean week — the exact failure `check:follow-ups` was taught to
 * report as SKIPPED rather than `ok`.
 */

export const FILING_LIMITS = Object.freeze({
  /** New issues one run may open, however much it saw. */
  maxNewIssuesPerRun: 3,
  /** New issues one persona may open in a run, so one bad surface cannot take the whole budget. */
  maxNewIssuesPerPersona: 1,
  /** While this many persona issues are open, a run files nothing new. */
  inboxCeiling: 10,
  /** How long an open issue is left alone before the run says "still true". */
  reconfirmAfterDays: 28,
});

/** The label every issue this run opens carries, alongside `needs-triage`. */
export const PERSONA_LABEL = "persona-bot";

/** The prefix that makes a fingerprint greppable in an issue body and in search. */
export const FINGERPRINT_PREFIX = "persona-bot:";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The evidence, with everything that legitimately differs between two runs
 * taken out: uuids, hex ids, ports, digits, and an absolute origin reduced to
 * its path. What is left is the *shape* of the failure, which is what a
 * fingerprint should be about.
 *
 * Getting this wrong in the loose direction merges two real defects into one
 * issue; getting it wrong in the tight direction files the same defect every
 * week under a new fingerprint, which is the failure this whole module exists
 * to prevent. So it errs loose.
 */
export function normalizeDetail(text) {
  return String(text ?? "")
    .replace(/https?:\/\/[^/\s]+/g, "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * The stable name of a finding: persona, lens, stop and normalised evidence.
 *
 * Twelve hex characters, which is plenty for a tracker that holds tens of these
 * and short enough to read in a title.
 */
export function fingerprint(finding) {
  const parts = [
    finding.personaId,
    finding.lens,
    finding.stopId,
    normalizeDetail(finding.detail),
  ].join("|");
  return createHash("sha256").update(parts).digest("hex").slice(0, 12);
}

/** `persona-bot:ab12cd34ef56` — what the body carries and the next run searches for. */
export function fingerprintToken(finding) {
  return `${FINGERPRINT_PREFIX}${finding.fingerprint ?? fingerprint(finding)}`;
}

/** Reads a fingerprint back out of an issue body. `null` when the body carries none. */
export function fingerprintFromBody(body) {
  const match = String(body ?? "").match(new RegExp(`${FINGERPRINT_PREFIX}([0-9a-f]{6,64})`, "i"));
  return match ? match[1].toLowerCase() : null;
}

/**
 * One row per fingerprint, carrying how many times the run saw it and every
 * screenshot it left. A lens that fires on three stops of one persona's walk
 * with the same evidence is one finding, not three.
 */
export function collapseFindings(findings) {
  const byFingerprint = new Map();
  for (const finding of findings) {
    const id = finding.fingerprint ?? fingerprint(finding);
    const existing = byFingerprint.get(id);
    if (!existing) {
      byFingerprint.set(id, {
        ...finding,
        fingerprint: id,
        occurrences: 1,
        screenshots: finding.screenshot ? [finding.screenshot] : [],
      });
      continue;
    }
    existing.occurrences += 1;
    if (finding.screenshot && !existing.screenshots.includes(finding.screenshot)) {
      existing.screenshots.push(finding.screenshot);
    }
  }
  return [...byFingerprint.values()];
}

/**
 * Most consequential first: lens severity, then the persona's own number so a
 * tie reads in `personas.md` order, then the fingerprint so the order is total
 * and a run is reproducible.
 */
export function rankFindings(findings, lenses) {
  return [...findings].sort((a, b) => {
    const severity = (lenses[a.lens]?.severity ?? 99) - (lenses[b.lens]?.severity ?? 99);
    if (severity !== 0) return severity;
    const persona = (a.personaNumber ?? 99) - (b.personaNumber ?? 99);
    if (persona !== 0) return persona;
    return a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0;
  });
}

/**
 * What this run should do with what it saw.
 *
 * @param findings collapsed findings, each carrying `fingerprint`
 * @param openIssues `{ number, title, fingerprint, lastReportedAt }` for every
 *   open issue already carrying the persona label
 * @param lenses the `LENSES` registry, for severity
 * @param now the instant the run is happening
 * @param limits overrides for `FILING_LIMITS`
 * @returns `{ file, comment, quiet, suppressed, totals }` — a plan, not an act.
 */
export function planFilings({ findings, openIssues = [], lenses, now, limits = {} }) {
  const caps = { ...FILING_LIMITS, ...limits };
  const at = now instanceof Date ? now : new Date(now);
  const knownByFingerprint = new Map();
  for (const issue of openIssues) {
    if (issue.fingerprint) knownByFingerprint.set(issue.fingerprint, issue);
  }

  const ranked = rankFindings(collapseFindings(findings), lenses);
  const file = [];
  const comment = [];
  const quiet = [];
  const suppressed = [];
  const perPersona = new Map();
  const inboxFull = openIssues.length >= caps.inboxCeiling;

  for (const finding of ranked) {
    const known = knownByFingerprint.get(finding.fingerprint);
    if (known) {
      const last = known.lastReportedAt ? new Date(known.lastReportedAt).getTime() : 0;
      const due = at.getTime() - last >= caps.reconfirmAfterDays * DAY_MS;
      (due ? comment : quiet).push({ issue: known, finding });
      continue;
    }
    if (inboxFull) {
      suppressed.push({ finding, reason: "inbox-full" });
      continue;
    }
    if (file.length >= caps.maxNewIssuesPerRun) {
      suppressed.push({ finding, reason: "run-cap" });
      continue;
    }
    const taken = perPersona.get(finding.personaId) ?? 0;
    if (taken >= caps.maxNewIssuesPerPersona) {
      suppressed.push({ finding, reason: "persona-cap" });
      continue;
    }
    perPersona.set(finding.personaId, taken + 1);
    file.push({ finding });
  }

  return {
    file,
    comment,
    quiet,
    suppressed,
    caps,
    totals: {
      seen: ranked.length,
      filed: file.length,
      commented: comment.length,
      quiet: quiet.length,
      suppressed: suppressed.length,
      openBefore: openIssues.length,
      inboxFull,
    },
  };
}

/** The reason a suppression is given, in words, for the summary. */
export function suppressionReason(reason, caps) {
  switch (reason) {
    case "inbox-full":
      return `the tracker already holds ${caps.inboxCeiling} open persona issues`;
    case "run-cap":
      return `this run had already filed its ${caps.maxNewIssuesPerRun}`;
    case "persona-cap":
      return `that persona had already filed one this run`;
    default:
      return reason;
  }
}

/** `Persona walk (Nadia): the storefront rendered no heading` — what to fix, and who found it. */
export function renderIssueTitle(finding) {
  return `Persona walk (${finding.personaName}): ${finding.headline}`;
}

/**
 * The issue body, in the shape `docs/agents/issue-tracker.md` requires and
 * `pnpm check:follow-ups` reads: the metadata lines, the four sections, real
 * `Touches:` paths, and a fenced prompt that names files and ends by telling
 * the session to close the issue.
 *
 * Written to be actionable cold — the reader was not on the walk, so the body
 * says which persona was walking, which surface they were on, what the lens
 * saw verbatim, and how to reproduce it in one command.
 */
export function renderIssueBody(finding, { lenses, runUrl, runAt, artifactName }) {
  const lens = lenses[finding.lens] ?? { kind: "improvement", title: finding.lens };
  const touches = [...new Set([...(finding.touches ?? []), "docs/product/personas.md"])];
  const seen = new Date(runAt).toISOString().slice(0, 10);
  const shots = finding.screenshots ?? [];

  const lines = [];
  lines.push(`**Kind:** ${lens.kind}`);
  // A coarse guess from the lens, because a bot cannot size work: the four
  // lenses that mean something is broken get M, the four that mean something is
  // below a standard get S. Whoever triages it knows better and should say so.
  lines.push(`**Effort:** ${lens.kind === "risk" ? "M" : "S"}`);
  lines.push(`**Touches:** ${touches.map((path) => `\`${path}\``).join(", ")}`);
  lines.push("");
  lines.push(`**Persona:** ${finding.personaLabel}`);
  lines.push(`**Surface:** \`${finding.url}\` (stop \`${finding.stopId}\`)`);
  lines.push(`**Lens:** \`${finding.lens}\` — ${lens.title}`);
  lines.push(`**Fingerprint:** \`${fingerprintToken(finding)}\``);
  lines.push(`**Seen:** the persona walk of ${seen}${runUrl ? ` ([run](${runUrl}))` : ""}`);
  lines.push("");
  lines.push("## What I noticed");
  lines.push("");
  lines.push(
    `Walking ${finding.personaName} through their own surfaces, the \`${finding.lens}\` lens caught ` +
      `this at \`${finding.url}\`: ${finding.headline}. What the lens actually saw is quoted below, ` +
      "verbatim, so a reader can tell the symptom from the diagnosis.",
  );
  lines.push("");
  lines.push("```text");
  lines.push(fenceSafe(finding.detail));
  lines.push("```");
  if (finding.occurrences > 1) {
    lines.push("");
    lines.push(`The same shape appeared ${finding.occurrences} times on this walk.`);
  }
  if (shots.length > 0) {
    lines.push("");
    lines.push(
      runUrl
        ? `Screenshot: \`${shots.join("`, `")}\` in the \`${artifactName}\` artifact of [that run](${runUrl}).`
        : `Screenshot: \`${shots.join("`, `")}\`.`,
    );
  }
  lines.push("");
  lines.push("## Why it isn't already done");
  lines.push("");
  lines.push(whyNotDone(finding));
  lines.push("");
  lines.push("## Proposed change");
  lines.push("");
  lines.push(proposedChange(finding));
  lines.push("");
  lines.push("## Prompt");
  lines.push("");
  lines.push("```text");
  lines.push(prompt(finding));
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/**
 * Evidence, safe to put inside a fence. A backtick run of three would close the
 * block early and let the rest of a console message out into the body, taking
 * the `## Prompt` heading below it with it — which `check:follow-ups` would
 * then report as a missing section on an issue nobody wrote by hand.
 * A leading `#` is likewise dropped to a space: `section()` cuts a section at
 * the next line starting with one.
 */
function fenceSafe(detail) {
  return String(detail ?? "")
    .replace(/`{3,}/g, "'''")
    .replace(/^(#{1,6}) /gm, " $1 ")
    .slice(0, 1500);
}

function whyNotDone(finding) {
  return (
    `Nobody chose to leave it: the weekly persona walk (N-61, \`scripts/persona-bots/\`) reports and ` +
    `never gates, so a finding lands here rather than reddening a build. The walk can see the symptom ` +
    `but not decide the fix — whether ${finding.personaName} is looking at a real defect, a surface ` +
    `that is deliberately this way, or a lens that is too blunt for this page is a judgement a person ` +
    `makes. That call is the first step of the work, not a preliminary to it.`
  );
}

function proposedChange(finding) {
  const surface = (finding.touches ?? [])[0];
  const where = surface ? `\`${surface}\`` : "the surface the URL above resolves to";
  switch (finding.lens) {
    case "stop-unreachable":
      return (
        `Open ${where} and find out why the walk could not get to it. A route that answers for a ` +
        `person and not for this run usually means a redirect, a permission gate, or a selector the ` +
        `page no longer renders; the last of those is a change to \`scripts/persona-bots/personas.mjs\`, ` +
        `the other two are the product's. Do not widen a timeout to make the stop pass.`
      );
    case "blank-render":
      return (
        `Load ${where} the way the walk did and confirm what a reader gets. A diver Client Component ` +
        `reading copy without a \`DiverIntlProvider\` above it throws during the server render and ` +
        `degrades to a blank client-only 200, which is exactly this symptom; ` +
        `\`src/i18n/provider-coverage.test.ts\` is where that is pinned. Fix the render, then add the ` +
        `case to a test so it cannot come back silently.`
      );
    case "request-failed":
      return (
        `Reproduce the request from ${where} and read the server's own log line for it. A 4xx that ` +
        `the page treats as ordinary should not be requested at all; a 5xx is a defect with a stack ` +
        `behind it. Fix the cause rather than swallowing the response, and add a regression test at ` +
        `the layer that produced the status.`
      );
    case "console-error":
      return (
        `Reproduce it against ${where} and read the stack. A hydration mismatch, a serialization ` +
        `warning and a thrown effect all arrive here and all mean something real. Fix the cause and ` +
        `pin it with a test; do not silence the console.`
      );
    case "axe":
      return (
        `Fix the rule at ${where}, then decide whether the surface belongs in \`e2e/a11y.spec.ts\`'s ` +
        `scanned set so the fix is held. Contrast failures are usually a token choice rather than a ` +
        `one-off colour (ADR-0004), so change the token or the component, never a hard-coded hex at ` +
        `the call site.`
      );
    case "page-language":
      return (
        `The reader asked for one language in \`Accept-Language\` and the document declared another. ` +
        `Check how ${where} resolves the request locale against \`requestLocale()\` ` +
        `(\`src/i18n/request-locale.ts\`) and where \`<html lang>\` is set in the layout above it. ` +
        `The fix is in the resolution order, not a per-page override.`
      );
    case "no-skip-link":
      return (
        `Add the skip link the rest of the app carries to the layout above ${where}, matching the ` +
        `existing one rather than inventing a second pattern, and take its words from the message ` +
        `bundle. \`e2e/a11y.spec.ts\` already asserts the link on the surfaces it scans; extend that ` +
        `set to this one.`
      );
    case "tap-target":
      return (
        `Give the control at ${where} a real box: the element's own rectangle must clear 44px, not a ` +
        `pseudo-element overlay a parent clips. Reach for the shared wrappers in ` +
        `\`src/components/ui/\` rather than a hand-rolled class string, and add the page to ` +
        `\`TAP_TARGET_PAGES\` in \`e2e/a11y.spec.ts\` so the floor is held.`
      );
    default:
      return (
        `Read ${where} against the persona's own checklist in \`docs/product/personas.md\` and decide ` +
        `what the right behaviour is before changing anything.`
      );
  }
}

function prompt(finding) {
  const touches = (finding.touches ?? []).map((path) => `\`${path}\``).join(", ");
  return [
    `A weekly persona walk found this while walking ${finding.personaName}, persona ${finding.personaNumber}`,
    `in docs/product/personas.md, through their own surfaces: at ${finding.url}, the ${finding.lens} lens`,
    `reported "${finding.headline}".`,
    "",
    `Read docs/product/personas.md section ${finding.personaNumber} first, so you know what this person`,
    "needs from the surface, then read scripts/persona-bots/personas.mjs to see the exact stop that was",
    `walked. The code to change is under ${touches || "the route the URL above resolves to"}.`,
    "",
    "Reproduce it with `pnpm personas --persona " + finding.personaId + "`, which builds the e2e",
    "production build, walks that one persona against the seeded demo shop and writes its findings and",
    "screenshots to `personas/` without touching the tracker. Done is: the walk no longer reports this",
    "finding, the cause is fixed rather than the lens narrowed, and a test holds it — a unit test where",
    "the logic lives, or an `e2e/` assertion where only a rendered page can show it. Run `pnpm lint`,",
    "`pnpm typecheck`, the focused test you added, and `pnpm check:repo`. Close this issue when the",
    "work lands.",
  ].join("\n");
}

/**
 * The marker a re-confirmation carries, so the next run can find the last one
 * it left without mistaking a human's comment for its own word.
 */
export const RECONFIRM_MARKER = "<!-- persona-bot:reconfirm -->";

/** The comment a recurring finding gets, once the re-confirm window has passed. */
export function renderRecurrenceComment(finding, { runUrl, runAt, caps }) {
  const seen = new Date(runAt).toISOString().slice(0, 10);
  return [
    `Still here. The persona walk of ${seen} saw this again at \`${finding.url}\`, walking ` +
      `${finding.personaName}.`,
    "",
    `This is the first word since the ${caps.reconfirmAfterDays}-day re-confirm window opened; ` +
      "every walk in between saw it too and stayed quiet, so nothing about the frequency has changed.",
    runUrl ? `\n[The run](${runUrl}).` : "",
    "",
    RECONFIRM_MARKER,
  ]
    .join("\n")
    .trim();
}

/**
 * The run written up — `personas/summary.md`, and the workflow's job summary.
 *
 * It says what every walk saw, what was filed, what was recognised and left
 * alone, and **what was suppressed and why**. That last section is the one that
 * has to be there on a quiet week as much as a loud one: a capped run that
 * printed only its three issues would read as a clean week, and the whole point
 * of a cap is that it is honest about what it is holding back.
 */
export function renderSummary(plan, { lenses, runAt, runUrl, stops, personas }) {
  const { totals, caps } = plan;
  const lines = [];
  lines.push("# Persona walk");
  lines.push("");
  lines.push(
    `${personas} personas over ${stops} stops on ${new Date(runAt).toISOString().slice(0, 10)}` +
      `${runUrl ? ` ([run](${runUrl}))` : ""}.`,
  );
  lines.push("");
  lines.push(
    `**${totals.seen} distinct findings.** Filed ${totals.filed}, commented on ${totals.commented} ` +
      `already open, left ${totals.quiet} open and quiet, suppressed ${totals.suppressed}.`,
  );
  lines.push("");
  if (totals.inboxFull) {
    lines.push(
      `The tracker already holds ${totals.openBefore} open persona issues, at or over the ceiling of ` +
        `${caps.inboxCeiling}, so this run filed nothing new. Triaging those is what lets the next ` +
        "run speak.",
    );
    lines.push("");
  }

  if (plan.file.length > 0) {
    lines.push("## Filed");
    lines.push("");
    for (const entry of plan.file) {
      lines.push(`- ${row(entry.finding, entry.issueNumber, lenses)}`);
    }
    lines.push("");
  }
  if (plan.comment.length > 0) {
    lines.push("## Still here");
    lines.push("");
    for (const entry of plan.comment) {
      lines.push(`- #${entry.issue.number} — ${row(entry.finding, null, lenses)}`);
    }
    lines.push("");
  }
  if (plan.quiet.length > 0) {
    lines.push("## Open, and inside the re-confirm window");
    lines.push("");
    lines.push(
      `Seen again and deliberately not commented on: an open issue is re-confirmed at most once ` +
        `every ${caps.reconfirmAfterDays} days.`,
    );
    lines.push("");
    for (const entry of plan.quiet) {
      lines.push(`- #${entry.issue.number} — ${row(entry.finding, null, lenses)}`);
    }
    lines.push("");
  }
  if (plan.suppressed.length > 0) {
    lines.push("## Suppressed");
    lines.push("");
    lines.push(
      "Real findings this run chose not to file, so the inbox stays readable. They are listed in " +
        "full here and will be filed by a later run as room appears.",
    );
    lines.push("");
    for (const entry of plan.suppressed) {
      lines.push(
        `- ${row(entry.finding, null, lenses)} — held back because ${suppressionReason(entry.reason, caps)}`,
      );
    }
    lines.push("");
  }
  if (totals.seen === 0) {
    lines.push("Every persona reached every stop, and no lens reported anything.");
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function row(finding, issueNumber, lenses) {
  const lens = lenses[finding.lens]?.title ?? finding.lens;
  const filed = issueNumber ? `#${issueNumber} ` : "";
  return `${filed}**${finding.personaName}** at \`${finding.url}\`: ${finding.headline} (${lens}, \`${finding.fingerprint}\`)`;
}
