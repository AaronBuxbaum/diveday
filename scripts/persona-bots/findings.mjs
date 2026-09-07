/**
 * What the weekly persona walk is allowed to do to a one-person triage inbox
 * (N-61), and the shape of the issues it files.
 *
 * The walk (`walk.spec.ts`) reports raw findings. This module is the pure half
 * that turns them into `needs-triage` issues and — the part that matters —
 * decides how few of them may exist. Fifteen personas walking forty-odd
 * surfaces every week can find a great deal; an inbox one person reads cannot
 * absorb a great deal, and a tracker nobody can face is worth less than no
 * tracker at all. So the volume policy is code, not intention:
 *
 *  1. **A finding class is one issue, however many pages it fires on.** A
 *     contrast rule failing on eleven surfaces is one issue listing eleven
 *     surfaces, never eleven issues. This is the biggest lever by far.
 *  2. **A class already open is commented on, never re-filed.** The comment
 *     says the run still sees it and on which surfaces, so an aging issue
 *     carries evidence it is still live rather than only a date.
 *  3. **A class whose issue is closed is never filed again.** A human read it
 *     and ended it; a bot that re-opens that argument every Monday is a bot
 *     that gets muted. Suppressions are printed in the run summary, so this is
 *     visible rather than silent.
 *  4. **{@link NEW_ISSUES_PER_RUN} new issues per run, and no more.** What does
 *     not fit is reported and dropped — never queued, because a queue would
 *     just move the flood a week later. The next run finds it again if it is
 *     still true, which is the honest test of whether it mattered.
 *  5. **A full inbox stops the bot entirely.** At or above
 *     {@link INBOX_BRAKE} open `needs-triage` issues the run files nothing at
 *     all and says so. The bot yields to the human, never the other way round.
 *  6. **A broken run files nothing.** Fail open: this is a report, never a
 *     gate, and a walk that could not complete has no findings worth trusting.
 *
 * Everything here is pure, so `findings.test.mjs` can prove the ceiling holds
 * without a browser or a network — including the check that every body it
 * renders passes `findIssueProblems` from `scripts/check-follow-ups.mjs`, the
 * same guard that reads the live tracker inside `pnpm check:repo`. A single
 * malformed issue filed by this bot would redden every open pull request in
 * the repository, so the generator validates its own output and refuses to
 * file anything that does not pass.
 */

import { AXE_PROBE, personaById, probeFor } from "./personas.mjs";

/** New issues one weekly run may file. Twelve a month is the ceiling this sets. */
export const NEW_ISSUES_PER_RUN = 3;

/** Comments one run may add to issues it filed earlier. Cheap, but still bounded. */
export const COMMENTS_PER_RUN = 5;

/**
 * Open `needs-triage` issues at which the bot stops filing altogether.
 *
 * Not a guess at a good inbox size — it is the point past which one person
 * reading one tracker is already behind, and the bot's own additions stop
 * being the useful half of the week. `pnpm gates` ages this same inbox; if it
 * is over the brake, the ages are the thing to read, not another finding.
 */
export const INBOX_BRAKE = 40;

/** The marker that makes an issue findable again next week. Invisible in rendered Markdown. */
export function fingerprint(probeId) {
  return `<!-- persona-bot:${probeId} -->`;
}

/** Does this issue body carry the marker for that class? */
export function carriesFingerprint(body, probeId) {
  return String(body ?? "").includes(fingerprint(probeId));
}

const IMPACT_RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };

/**
 * Raw findings → one class per probe, with the surfaces it fired on.
 *
 * A finding is `{ probe, path, personas, detail, impact }`. Ordering is by
 * impact, then by how many surfaces the class reaches, then by probe id, so
 * two runs over the same tree rank identically and the cap always cuts the
 * same tail.
 */
export function classify(findings) {
  const classes = new Map();
  for (const finding of findings) {
    let entry = classes.get(finding.probe);
    if (!entry) {
      entry = { probe: finding.probe, impact: finding.impact ?? "moderate", surfaces: [] };
      classes.set(finding.probe, entry);
    }
    if ((IMPACT_RANK[finding.impact] ?? 9) < (IMPACT_RANK[entry.impact] ?? 9)) {
      entry.impact = finding.impact;
    }
    // One entry per *surface*, not per visit: a staff page walked as two roles
    // reports twice, and an issue listing the same URL twice reads as a bug in
    // the bot rather than as two readers finding one defect.
    const already = entry.surfaces.find((surface) => surface.path === finding.path);
    if (already) {
      already.personas = [...new Set([...already.personas, ...(finding.personas ?? [])])];
      if (!already.detail) already.detail = finding.detail ?? "";
      continue;
    }
    entry.surfaces.push({
      path: finding.path,
      personas: [...(finding.personas ?? [])],
      detail: finding.detail ?? "",
    });
  }
  return [...classes.values()]
    .map((entry) => ({
      ...entry,
      surfaces: entry.surfaces.sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort(
      (a, b) =>
        (IMPACT_RANK[a.impact] ?? 9) - (IMPACT_RANK[b.impact] ?? 9) ||
        b.surfaces.length - a.surfaces.length ||
        a.probe.localeCompare(b.probe),
    );
}

/**
 * The whole volume policy in one pure function.
 *
 * @param classes  from {@link classify}
 * @param openIssues   open `needs-triage` issues (`{ number, title, body }`)
 * @param closedIssues closed `needs-triage` issues, for rule 3
 * @returns what the run will do, and why it will not do the rest
 */
export function planRun({ classes, openIssues = [], closedIssues = [] }) {
  const plan = { file: [], comment: [], suppressed: [], deferred: [], brake: null };

  if (openIssues.length >= INBOX_BRAKE) {
    plan.brake =
      `${openIssues.length} needs-triage issues are already open, at or over the ${INBOX_BRAKE} ` +
      "the persona walk stops filing at. Nothing was filed or commented on this run.";
    plan.deferred = classes.map((entry) => ({ ...entry, why: "inbox brake" }));
    return plan;
  }

  for (const entry of classes) {
    const open = openIssues.find((issue) => carriesFingerprint(issue.body, entry.probe));
    if (open) {
      if (plan.comment.length < COMMENTS_PER_RUN) plan.comment.push({ ...entry, issue: open });
      else plan.deferred.push({ ...entry, why: `over the ${COMMENTS_PER_RUN}-comment ceiling` });
      continue;
    }
    const closed = closedIssues.find((issue) => carriesFingerprint(issue.body, entry.probe));
    if (closed) {
      plan.suppressed.push({ ...entry, issue: closed });
      continue;
    }
    if (plan.file.length < NEW_ISSUES_PER_RUN) plan.file.push(entry);
    else plan.deferred.push({ ...entry, why: `over the ${NEW_ISSUES_PER_RUN}-issue ceiling` });
  }
  return plan;
}

/** `Nadia (1), Tomas (2)` — the personas a class was found under, named. */
function namePersonas(ids) {
  const named = [...new Set(ids)]
    .map((id) => personaById(id))
    .filter(Boolean)
    .sort((a, b) => a.number - b.number)
    .map((persona) => `${persona.name} (${persona.number})`);
  return named.length > 0 ? named.join(", ") : "the persona walk";
}

/**
 * The `src/app/**\/page.tsx` behind a URL path, when the route ledger knows one
 * and it is on disk. Returned so the filed issue's `Touches:` line names the
 * file the work is actually in rather than only its directory.
 *
 * @param routes route patterns, i.e. the keys of `scripts/route-coverage.json`
 * @param exists a predicate over a repo-relative path
 */
export function sourceFileForPath(urlPath, routes, exists) {
  const [withoutQuery] = String(urlPath).split(/[?#]/, 1);
  const segments = withoutQuery.split("/").filter(Boolean);
  const match = routes.find((pattern) => {
    const wanted = pattern.split("/").filter(Boolean);
    if (wanted.length !== segments.length) return false;
    return wanted.every((part, index) => part.startsWith("[") || part === segments[index]);
  });
  if (!match) return null;
  const file = `src/app${match === "/" ? "" : match}/page.tsx`;
  return exists(file) ? file : null;
}

/**
 * One class rendered as a `needs-triage` issue.
 *
 * The four sections and the fenced prompt are what
 * `scripts/check-follow-ups.mjs` reads; the shape is
 * docs/agents/issue-tracker.md's "Filing a follow-up". Written for a reader who
 * was not in the run: every surface is named with its URL, the persona line it
 * breaks is quoted, and the prompt names the files to open and ends by telling
 * the session to close the issue.
 *
 * @param runContext `{ runUrl, artifactName, screenshots }` — where the pictures are
 */
export function renderIssue(entry, { runContext = {}, touches = [] } = {}) {
  const probe = probeFor(entry.probe) ?? AXE_PROBE;
  const count = entry.surfaces.length;
  const title = probe.title
    ? probe.title(count)
    : `Fix ${entry.probe} on ${count} persona surfaces`;
  const owner = personaById(probe.persona);
  const ownerName = owner ? `${owner.name} (${owner.number}), ${owner.lens}` : "the persona frame";
  const allTouches = [...new Set([...(probe.touches ?? []), ...touches])];

  const surfaceLines = entry.surfaces.map((surface) => {
    const shot = runContext.screenshots?.[surface.path];
    const picture = shot ? ` — screenshot \`${shot}\`` : "";
    const detail = surface.detail ? ` ${surface.detail}` : "";
    return `- \`${surface.path}\` — walked as ${namePersonas(surface.personas)}.${detail}${picture}`;
  });

  const where = runContext.runUrl
    ? `The screenshots are the \`${runContext.artifactName ?? "persona-bots"}\` artifact on ${runContext.runUrl}.`
    : "This run kept its screenshots locally rather than uploading them.";

  const body = [
    fingerprint(entry.probe),
    "",
    `**Kind:** ${probe.kind}`,
    `**Effort:** ${probe.effort}`,
    `**Touches:** ${allTouches.map((item) => `\`${item}\``).join(", ")}`,
    "",
    "## What I noticed",
    "",
    `The weekly persona walk opened every surface in \`docs/product/personas.md\` against the demo shop and this probe fired on ${count === 1 ? "one of them" : `${count} of them`}. The line it holds is ${probe.line}, and the walk found it broken here:`,
    "",
    ...surfaceLines,
    "",
    where,
    "",
    "## Why it isn't already done",
    "",
    `Nothing here was in the scope of any one change: the walk is a standing sweep across all fifteen personas rather than a review of a single pull request, so this surface was not what anybody was editing when the defect arrived. The probe is mechanical and reports facts from the rendered page, but choosing the fix — which component, which token, which message key — is a judgement call this run does not make. It is filed rather than fixed for that reason, and because the reader it costs is ${ownerName} — who is, by definition, not the reader who would have noticed.`,
    "",
    "## Proposed change",
    "",
    `Open each surface above in a browser, reproduce the probe's finding, and fix it where the markup is produced rather than where it renders — a shared component if the surfaces have one in common, the individual page if they do not. Do not silence the probe: \`scripts/persona-bots/personas.mjs\` is the registry it comes from, and narrowing it there to make a run green would take the coverage with it. If one of the surfaces turns out to be a false positive, say so in this issue and tighten the probe's own condition instead of dropping the surface.`,
    "",
    "## Prompt",
    "",
    "```text",
    ...promptLines(entry, probe, allTouches),
    "```",
    "",
  ].join("\n");

  return { title, body };
}

/**
 * The pasteable prompt. Long enough to brief a session with none of this run's
 * context (`check-follow-ups.mjs` asks for forty words), naming real paths, and
 * ending with the instruction to close the issue.
 */
function promptLines(entry, probe, touches) {
  const paths = touches.slice(0, 4).join(", ");
  return [
    `Read docs/product/personas.md first, then scripts/persona-bots/personas.mjs, which holds the probe registry the weekly persona walk runs. This issue was filed by that walk: the probe "${entry.probe}" fired on ${entry.surfaces.length} surface(s) of the demo shop, listed in the issue body above with the URL of each.`,
    "",
    `The line being held is ${probe.line}. Start in ${paths}.`,
    "",
    "Reproduce it first: run `pnpm dev`, wait for the supervisor's `serving` line, then `node scripts/screenshot.mjs <path>` for each surface named above and look at what came back. Fix the cause in the component or page that produces the markup, not at the call site that renders it, and never by narrowing the probe.",
    "",
    "Done is: the defect is gone on every surface the issue names, `pnpm check` passes, and a focused `pnpm e2e e2e/a11y.spec.ts --reporter=line` still passes if the fix touched anything that spec scans. Add or extend a test that would have caught it. Close this issue when the work lands.",
  ];
}

/** The comment left on an issue this class already has open. */
export function renderComment(entry, { runContext = {} } = {}) {
  const surfaces = entry.surfaces.map((surface) => `- \`${surface.path}\``).join("\n");
  const where = runContext.runUrl ? ` Run: ${runContext.runUrl}` : "";
  return [
    `The weekly persona walk still sees this on ${entry.surfaces.length} surface(s):`,
    "",
    surfaces,
    "",
    `Nothing new was filed for it — this issue is the one open for the \`${entry.probe}\` class.${where}`,
  ].join("\n");
}

/**
 * The run written up for whoever reads the workflow log: what was found, what
 * was filed, and — the half that keeps the policy honest — what was
 * deliberately not filed and why.
 */
export function renderSummary({ plan, classes, findings, dryRun, walked, planned }) {
  const lines = [];
  // The surface count leads deliberately. An empty finding list is what a
  // clean week and a walk that never opened anything both look like, and this
  // repository has been burned by that shape before (a visual run with no
  // baseline resolved reports zero differences).
  lines.push(
    `persona-bots: walked ${walked ?? "?"} of ${planned ?? "?"} surfaces; ` +
      `${findings.length} finding(s) across ${classes.length} class(es).`,
  );
  if (plan.brake) lines.push(`persona-bots: ${plan.brake}`);
  const verb = dryRun ? "would file" : "filed";
  for (const entry of plan.file) {
    lines.push(`  ${verb}: ${entry.probe} (${entry.surfaces.length} surface(s), ${entry.impact})`);
  }
  for (const entry of plan.comment) {
    lines.push(
      `  ${dryRun ? "would comment on" : "commented on"} #${entry.issue.number}: ${entry.probe}`,
    );
  }
  for (const entry of plan.suppressed) {
    lines.push(
      `  suppressed: ${entry.probe} — #${entry.issue.number} was closed, so it is never re-filed`,
    );
  }
  for (const entry of plan.deferred) {
    lines.push(`  not filed: ${entry.probe} — ${entry.why}`);
  }
  if (plan.file.length === 0 && plan.comment.length === 0) {
    lines.push("persona-bots: nothing to file this week.");
  }
  return lines.join("\n");
}
