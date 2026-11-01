# Backlog routine: each step of the loop, in full

Part of the **backlog-routine** skill ([SKILL.md](SKILL.md)). The SKILL.md loop is the checklist; this is each step with its commands, its incidents and its edge cases. Read a step here the first time you run it in a session, and whenever a step's outcome surprises you.

## The loop

1. **Start from the main everyone else has been merging into.** `git fetch origin main` before
   every ticket, not once at the top of the session. This routine's own pull requests merge while it
   is still running — five of seven did in one session, one of them inside the minute a stack was
   being registered — so a branch cut from the `origin/main` you fetched an hour ago starts life
   behind, conflicts with work that is already in, and reads its own merged changes as somebody
   else's diff. Fetching costs a second; not fetching costs a rebase.
2. **Read what GitHub says about the pull requests you already opened**, in the same breath:

   ```sh
   R=repos/AaronBuxbaum/diveday
   gh api "$R/pulls?state=open&per_page=100" --jq '[.[] | select(.user.login == "<your login>") | {number, title, sha: .head.sha}]'
   gh api "$R/commits/<sha>/check-runs" --jq '.check_runs[] | {name, conclusion}'
   ```

   REST throughout: `gh pr list`, `gh pr checks` and `gh pr view` go through GraphQL, which cloud
   sessions are refused ([issue-tracker.md](../../../docs/agents/issue-tracker.md)).

   CI takes about ten minutes and you opened that pull request before you started the last ticket,
   so **its answer arrives while you are not looking.** A red check on your own branch is your work
   — the same rule as any failing test — and it does not become someone else's by being one ticket
   behind you. Two of one session's pull requests went red this way: a spec asserting the old 404
   wording, and a spec measuring a scroll position one frame early. Both were the change working;
   both would have shipped as somebody else's mystery if nothing had circled back.

   Fix it now, before the next ticket, and **on the branch that owns the defect** — which in a stack
   is often not the layer the failure was reported on. See *When a lower layer goes red* in [stack.md](stack.md). The
   exception is a `reg` failure, which is the visual report and belongs to the human — read every
   diff image, explain each one in the pull request, and carry on
   ([visual-triage](../visual-triage/SKILL.md)).

   **An open `automation/durations-refresh` pull request gets an empty commit to start CI.** The
   weekly refresh (`.github/workflows/durations-refresh.yml`) commits the recorded shard durations
   straight to `main` and opens that pull request only when the push was refused. A pull request
   opened with the workflow token starts no CI, so it waits unchecked until someone pushes:
   `gh api "$R/pulls?state=open&head=AaronBuxbaum:automation/durations-refresh"`; if one is there, check it out,
   `git commit --allow-empty -m "Run CI on the durations refresh"`, and push so CI runs. Check its
   status with the other pull requests. Once it is green, name it as ready and stop for the human
   to merge it, as required by *What ends a turn* in [SKILL.md](SKILL.md). The diff is two JSON
   files that record shard durations for the next run.

   **Read the review comments in the same pass, not only the checks.** `sourcery-ai` reviews every
   pull request here within minutes of it opening, and Aaron's comments
   land whenever he gets to them — all of it arrives while you are building the next ticket, which
   is exactly why this step exists:

   ```sh
   gh api $R/issues/<n>/comments    # the conversation
   gh api $R/pulls/<n>/comments     # the inline review threads
   ```

   Answer each open thread before the next ticket: fix and reply with the commit, decline with the
   reason, or file a `needs-triage` issue and put the number in the thread. A bot does not know this
   repository's rules and will confidently propose changes `pnpm check:repo` refuses — check before
   acting (AGENTS.md's Hard rules). A thread you never read is a pull request that is not done, and
   under this routine nobody else is coming back for it.
3. **Pick.** `gh api "repos/AaronBuxbaum/diveday/issues?labels=ready-for-agent&state=open&per_page=100"`
   (REST; `gh issue` is GraphQL and refused in cloud sessions), skipping anything already
   labelled `in-progress`. Read `pnpm gates`' "Claimed — in flight" section first: a claim it
   reports **stale** is a dead session, not a reservation, so that work is free to take.
4. **Refuse the ones that are not yours.** If the body carries a *Blocked by* section naming a
   human decision — what a waiver version number asserts, which unit a package sells in — do not
   build it. Relabel `ready-for-human`, say why in a comment, pick another. Three of the queue's
   issues were in that state and each said so in its own words.
5. **Claim.** Add `in-progress`, post the `## Claim` comment
   ([issue-tracker.md](../../../docs/agents/issue-tracker.md)) naming **this ticket's own layer**
   as `Branch:`. A stack here spans several unrelated tickets, so each carries its own claim; one
   claim covering several layers is only for a chain built for a single issue.
6. **Check the premise before building it.** Roughly half of these tickets describe something that
   is no longer true, or true for a different reason. Reproduce it first — render the page, read the
   *compiled* CSS, run the query, count the call sites. Recent examples: "turning the contrast rule
   on would paint CI red" (it found 23 nodes and one mechanism), "any nav tap discards the form"
   (Activity keeps three routes; the real loss is invisible eviction), "eight surfaces disagree with
   their nav label" (four already agreed, through a duplicate message key). When the premise does
   not survive, say so in the PR **and** the issue, and build what the evidence supports.
7. **Cut the branch, commit once, open the draft PR and extend the stack** ([stack.md](stack.md)), then build it.
8. **Verify.** The local gate green (`pnpm check:repo`, `pnpm lint`, `pnpm typecheck`,
   the specs `pnpm e2e:affected` names; the whole `pnpm check` runs on CI and is the gate), and *look at* every surface you changed, in light (both schemes only for colour work).
   Read each visual diff against the actual image before writing a word about it —
   `pnpm visual:report --commit <sha>` writes the PNGs.
9. **Finish the PR you already opened** at step 7 — body, position line, diff explanation, and
   `Closes #n` under "## Follow-ups filed" for the ticket you claimed — and `gh pr ready` it. **Then go back to step 1** — fetch, re-read the queue, take the next one. Do
   not summarise, do not ask whether to continue, and do not wait for the pull request you just
   opened to merge: it is the human's to merge, and the next ticket does not depend on it.
