#!/usr/bin/env node
import path from "node:path";
// Closes the lower layers of a stack once its top pull request is merged into main.
//
// A stack lands as ONE pull request: the top layer is retargeted to main and merged with a squash,
// so every layer below it is already inside that commit. Those lower pull requests would otherwise
// sit open forever. This comments "Landed in #N with the rest of its stack.", closes each one and
// deletes its head branch.
//
// It acts on a pull request only when ALL of these hold: it is open, its head is in this
// repository (never a fork), its head commit is a strict ancestor of the merged head (so a layer
// above the merged one, which GitHub retargets to main itself, and an unrelated pull request are
// never touched), and it is not the merged pull request. A branch is deleted only while it still
// points at the commit that was checked and no other open pull request is based on it.
import process from "node:process";
import { fileURLToPath } from "node:url";

/** The comment each closed layer gets. */
export const landedComment = (number) => `Landed in #${number} with the rest of its stack.`;

/**
 * Which open pull requests the merged one carried.
 *
 * `merged` is `{ number, headSha }`. `open` is the repository's pull requests as
 * `{ number, state, headSha, headRef, headRepo, baseRef }`; `repo` is this repository's full name.
 * `ancestors` is the set of head shas the API said are strict ancestors of `merged.headSha`.
 * Returns `{ close: [{ number, headRef, deleteBranch }] }`.
 */
export function decide({ merged, open, repo, defaultBranch = "main", ancestors }) {
  const closing = open.filter(
    (pr) =>
      pr.state === "open" &&
      pr.number !== merged.number &&
      pr.headRepo === repo &&
      pr.headRef !== defaultBranch &&
      pr.headSha !== merged.headSha &&
      ancestors.has(pr.headSha),
  );
  const closingNumbers = new Set(closing.map((pr) => pr.number));
  return {
    close: closing.map((pr) => ({
      number: pr.number,
      headRef: pr.headRef,
      headSha: pr.headSha,
      // Another open pull request that is based on this branch still needs it.
      deleteBranch: !open.some(
        (other) =>
          other.state === "open" &&
          !closingNumbers.has(other.number) &&
          other.baseRef === pr.headRef,
      ),
    })),
  };
}

/**
 * Does the work. `api(method, pathname, body)` returns parsed JSON (null on 204) and throws on a
 * failure; it is injected for the test. Returns the log lines.
 */
export async function land(env, api) {
  const repo = env.GITHUB_REPOSITORY;
  const merged = { number: Number(env.PR_NUMBER), headSha: env.PR_HEAD_SHA };
  if (env.PR_MERGED !== "true" || env.PR_BASE_REF !== env.DEFAULT_BRANCH) {
    return ["Not a merge into the default branch; nothing to close."];
  }
  const open = [];
  for (let page = 1; ; page += 1) {
    const rows = await api("GET", `pulls?state=open&per_page=100&page=${page}`);
    for (const p of rows) {
      open.push({
        number: p.number,
        state: p.state,
        headSha: p.head.sha,
        headRef: p.head.ref,
        headRepo: p.head.repo?.full_name ?? null,
        baseRef: p.base.ref,
      });
    }
    if (rows.length < 100) break;
  }
  const candidates = open.filter(
    (p) => p.number !== merged.number && p.headRepo === repo && p.headSha !== merged.headSha,
  );
  const ancestors = new Set();
  for (const pr of candidates) {
    // "ahead" means the merged head is strictly ahead of this head: this head is an ancestor.
    const cmp = await api("GET", `compare/${pr.headSha}...${merged.headSha}`);
    if (cmp.status === "ahead") ancestors.add(pr.headSha);
  }
  const { close } = decide({
    merged,
    open,
    repo,
    defaultBranch: env.DEFAULT_BRANCH,
    ancestors,
  });
  if (close.length === 0) return ["No open pull request was carried by this merge."];
  const lines = [];
  for (const pr of close) {
    await api("POST", `issues/${pr.number}/comments`, {
      body: landedComment(merged.number),
    });
    await api("PATCH", `pulls/${pr.number}`, { state: "closed" });
    let note = "branch kept (another pull request is based on it)";
    if (pr.deleteBranch) {
      const ref = pr.headRef.split("/").map(encodeURIComponent).join("/");
      const tip = await api("GET", `git/ref/heads/${ref}`).catch(() => null);
      if (tip?.object?.sha === pr.headSha) {
        await api("DELETE", `git/refs/heads/${ref}`);
        note = "branch deleted";
      } else {
        note = "branch kept (it has moved or is gone)";
      }
    }
    lines.push(`Closed #${pr.number}: ${note}.`);
  }
  return lines;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token } = process.env;
  const api = async (method, pathname, body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${pathname}`, {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(`${method} ${pathname}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  const lines = await land(process.env, api);
  for (const line of lines) console.log(line);
}
