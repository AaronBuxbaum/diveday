// The issue tracker, over GitHub's REST API (`gh api`), for every script that reads or writes it.
//
// `gh issue …` and `gh pr …` go through GraphQL, and GraphQL answers HTTP 403 in Claude Code's
// cloud containers ("GitHub GraphQL is not available from Claude Code sessions; use the REST
// API"), while `gh api repos/…` REST answers. Until 2026-10-12 four scripts shelled to
// `gh issue`, so in the containers most of this repository is written in `pnpm gates` skipped its
// claims gate, `expire-claims` could not run, and `file-follow-up` could not file — sessions filed
// through the GitHub MCP instead, which the filing quota never counted. This module is the one
// door: `gate-freshness`, `check-follow-ups`, `expire-claims`, `file-follow-up`, `check-pr-body`
// and `agent-doctor` all reach GitHub through it.
//
// Reads return the shape the scripts were written against (`gh issue list --json`'s: camelCase
// `createdAt`, `labels: [{ name }]`, `comments: [{ body, createdAt }]`), so the callers' parsers
// did not change. Every failure throws a TrackerError; a caller that fails open catches it.
//
// Every write takes `{ dryRun }`: a dry run prints the request it would send and sends nothing.
//
// Issue text is untrusted. It is never part of an argument array: a write's fields travel as a
// JSON document on stdin (`gh api --input -`), and only numbers and constant paths reach argv.

import process from "node:process";

import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

export const DEFAULT_REPO = "AaronBuxbaum/diveday";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/** Labels that describe an open issue's queue; `closeIssue` strips them. */
export const OPEN_ONLY_LABELS = ["in-progress", "ready-for-agent"];

export class TrackerError extends Error {}

/** `owner/name` from `GITHUB_REPOSITORY` (set in Actions), else this repository. */
export function repoSlug(env = process.env) {
  const named = env.GITHUB_REPOSITORY ?? "";
  return /^[\w.-]+\/[\w.-]+$/.test(named) ? named : DEFAULT_REPO;
}

/**
 * How much a `gh api` call may print. spawnSync's default is 1 MiB, and one page of 100 closed
 * pull requests was 2,279,829 bytes on 2026-10-13 (their bodies are long): the read died with
 * ENOBUFS and `expire-claims` exited 2 on an empty "failed:" (seen again on the nightly run of
 * 2026-10-15, cut off with an empty stderr). Open-issue pages were 706 KB.
 */
export const GH_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * The real runner: `gh api <args>`, bounded, with an optional JSON document on stdin. `run` is
 * injectable so a test can read the options without spawning gh.
 */
export function ghApi(args, input, run = runBounded) {
  return run("gh", ["api", ...args], {
    encoding: "utf8",
    input,
    maxBuffer: GH_MAX_BUFFER,
    stdio: ["pipe", "pipe", "pipe"],
    timeoutMs: SUBPROCESS_TIMEOUTS.ghCli,
  });
}

/** One REST issue (or pull request listed as an issue) in `gh issue list --json`'s shape. */
export function toIssue(raw) {
  return {
    number: raw.number,
    title: raw.title ?? "",
    body: raw.body ?? "",
    state: String(raw.state ?? "").toUpperCase(),
    url: raw.html_url ?? "",
    createdAt: raw.created_at ?? "",
    labels: (raw.labels ?? []).map((label) => ({
      name: typeof label === "string" ? label : label.name,
    })),
    isPullRequest: Boolean(raw.pull_request),
  };
}

/** One REST comment in `gh issue view --json comments`' shape. */
export function toComment(raw) {
  return { body: raw.body ?? "", createdAt: raw.created_at ?? "" };
}

/**
 * The fields `toPull` reads, selected by `gh` itself so a page of pull requests carries no
 * bodies (2.28 MB a page with them, a few KB without).
 */
const PULL_FIELDS_JQ =
  "[.[] | {number, title, state, html_url, merged_at, head: {ref: .head.ref}}]";

/** One REST pull request, reduced to what the scripts read. */
export function toPull(raw) {
  return {
    number: raw.number,
    title: raw.title ?? "",
    state: String(raw.state ?? "").toUpperCase(),
    headRefName: raw.head?.ref ?? "",
    url: raw.html_url ?? "",
    mergedAt: raw.merged_at ?? null,
  };
}

/**
 * When `label` was last added to an issue, from its REST events (oldest first), or null when the
 * events never show it being added.
 */
export function lastLabelledAt(events, label) {
  let at = null;
  for (const event of events ?? []) {
    if (event.event === "labeled" && event.label?.name === label) at = event.created_at ?? at;
  }
  return at;
}

/**
 * A tracker bound to one repository and one runner. `run(args, input)` returns a `spawnSync`-like
 * `{ status, stdout, stderr }`; the tests pass recorded responses, the scripts take the default.
 */
export function createTracker({ repo = repoSlug(), run = ghApi, log = console.log } = {}) {
  const base = `repos/${repo}`;

  function call(args, input) {
    const result = run(args, input);
    if (result?.status !== 0) {
      // A spawn failure (ENOBUFS, ENOENT) leaves stderr empty; name its code, not nothing.
      const stderr = String(result?.stderr ?? "").trim();
      const spawn = result?.error
        ? [result.error.code, result.error.message].filter(Boolean).join(" ")
        : "";
      const why = (stderr || spawn || `gh exited ${result?.status}`).split("\n")[0];
      throw new TrackerError(`\`gh api ${args.join(" ")}\` failed: ${why}`);
    }
    const text = String(result.stdout ?? "").trim();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new TrackerError(`\`gh api ${args.join(" ")}\` returned unparseable JSON`);
    }
  }

  function get(endpoint, jq) {
    return call(jq ? [endpoint, "--jq", jq] : [endpoint]);
  }

  /** Every page of a list endpoint, up to `limit` items; `jq` filters each page inside `gh`. */
  function getAll(endpoint, limit, jq) {
    const items = [];
    const joiner = endpoint.includes("?") ? "&" : "?";
    for (let page = 1; page <= MAX_PAGES && items.length < limit; page += 1) {
      const batch = get(`${endpoint}${joiner}per_page=${PAGE_SIZE}&page=${page}`, jq) ?? [];
      if (!Array.isArray(batch)) throw new TrackerError(`${endpoint} did not return a list`);
      items.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return items.slice(0, limit);
  }

  function write(method, endpoint, fields, { dryRun = false } = {}) {
    if (dryRun) {
      log(`tracker (dry run): would ${method} ${endpoint} ${JSON.stringify(fields ?? {})}`);
      return null;
    }
    const args = ["--method", method, endpoint];
    if (fields === undefined) return call(args);
    return call([...args, "--input", "-"], JSON.stringify(fields));
  }

  const number = (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) throw new TrackerError(`not an issue number: ${value}`);
    return n;
  };

  const api = {
    repo,

    /**
     * Open (or `state`) issues carrying `label`, pull requests excluded. `comments: true` reads
     * each issue's comments too, one request per issue; only the claims gate needs them.
     */
    listIssues({ label, state = "open", comments = false, limit = 500 } = {}) {
      const query = [`state=${encodeURIComponent(state)}`];
      if (label) query.push(`labels=${encodeURIComponent(label)}`);
      const issues = getAll(`${base}/issues?${query.join("&")}`, limit)
        .map(toIssue)
        .filter((issue) => !issue.isPullRequest);
      if (!comments) return issues;
      return issues.map((issue) => ({ ...issue, comments: api.listComments(issue.number) }));
    },

    getIssue(issueNumber, { comments = false } = {}) {
      const issue = toIssue(get(`${base}/issues/${number(issueNumber)}`));
      return comments ? { ...issue, comments: api.listComments(issue.number) } : issue;
    },

    listComments(issueNumber) {
      return getAll(`${base}/issues/${number(issueNumber)}/comments`, 1000).map(toComment);
    },

    /** When `label` was last added to the issue (ISO string), or null. */
    labelledAt(issueNumber, label) {
      return lastLabelledAt(getAll(`${base}/issues/${number(issueNumber)}/events`, 1000), label);
    },

    listPulls({ state = "open", limit = 500 } = {}) {
      return getAll(`${base}/pulls?state=${encodeURIComponent(state)}`, limit, PULL_FIELDS_JQ).map(
        toPull,
      );
    },

    /** Files an issue; returns `{ number, url }` (null under a dry run). */
    createIssue({ title, body, labels = [] }, options) {
      const created = write("POST", `${base}/issues`, { title, body, labels }, options);
      return created ? { number: created.number, url: created.html_url ?? "" } : null;
    },

    comment(issueNumber, body, options) {
      return write("POST", `${base}/issues/${number(issueNumber)}/comments`, { body }, options);
    },

    /** Adds and removes labels; removing one the issue does not carry is not an error. */
    editLabels(issueNumber, { add = [], remove = [] } = {}, options) {
      const n = number(issueNumber);
      if (add.length > 0) write("POST", `${base}/issues/${n}/labels`, { labels: add }, options);
      for (const label of remove) {
        try {
          write(
            "DELETE",
            `${base}/issues/${n}/labels/${encodeURIComponent(label)}`,
            undefined,
            options,
          );
        } catch (error) {
          if (!/404|Label does not exist/i.test(String(error.message))) throw error;
        }
      }
    },

    /**
     * Closes the issue and strips the labels that only mean something on an open one. #2355
     * closed still carrying `in-progress` and `ready-for-agent`, and `pnpm gates` and the
     * backlog sweep both read labels, not state (2026-10-13 re-review, item 37).
     */
    closeIssue(issueNumber, { reason = "completed" } = {}, options) {
      const closed = write(
        "PATCH",
        `${base}/issues/${number(issueNumber)}`,
        { state: "closed", state_reason: reason },
        options,
      );
      api.editLabels(issueNumber, { remove: OPEN_ONLY_LABELS }, options);
      return closed;
    },
  };
  return api;
}

let shared;
/** The tracker the scripts use: this repository, the real `gh api`. */
export function tracker() {
  shared ??= createTracker();
  return shared;
}
