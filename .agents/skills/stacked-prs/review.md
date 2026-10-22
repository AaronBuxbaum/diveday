# Stacked PRs: answering review across layers

Part of the **stacked-prs** skill ([SKILL.md](SKILL.md)). Read it before answering any review comment on a stacked layer.

## Answering review across layers

Every layer is reviewed on its own — `sourcery-ai` comments on each one as it
opens, so a stack collects one review per layer — twelve layers, twelve reviews — while you are
still building the top of it. Read them per layer, on the same pass that reads each layer's CI:

```sh
R=repos/AaronBuxbaum/diveday
gh api "$R/pulls?state=open&per_page=100" --jq '[.[] | select(.user.login == "<your login>") | {number, title, head: .head.ref, sha: .head.sha}]'
gh api "$R/commits/<sha>/check-runs" --jq '.check_runs[] | {name, conclusion}'
gh api $R/issues/<n>/comments    # the conversation
gh api $R/pulls/<n>/comments     # the inline review threads
```

REST, never `gh pr list` / `gh pr view`: those go through GraphQL, which cloud sessions are refused
([docs/agents/issue-tracker.md](../../../docs/agents/issue-tracker.md)). The GitHub MCP server's
`search_pull_requests` and `pull_request_read` (method `get_review_comments`, which reports
`is_resolved` per thread) answer too — see AGENTS.md's rule about answering review threads for the
reply and resolve calls.

**Answer a comment on the layer that owns the code, never the layer you are standing on.** The
rule is the one that governs a red check in a stack, for the same reason: a stack merges bottom-up,
so a fix committed above the layer being commented on arrives *after* that layer has already merged
without it. Fix at the owning layer, then rebase each layer above onto the one below (on a
workstation, `gh stack sync --prune` does that in one).

Each thread ends in a state: fixed and replied to with the commit, declined with the reason, or
filed as a `needs-triage` issue whose number is in the thread. Commit whatever you are holding at
the top of the stack before you go down (never `git stash` — AGENTS.md's *Parallel work*).
