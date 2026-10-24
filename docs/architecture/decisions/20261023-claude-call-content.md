# 20261023-claude-call-content — DiveDay keeps what each Claude call said for 30 days, readable only by DiveDay

- **Status:** Accepted
- **Date:** 2026-10-23
- **Amends:** [20261018-claude-assists](20261018-claude-assists.md)

## Context

Aaron (2026-10-23, decision card in the "AI call logging check" thread): a wrong answer from an
assist cannot be fixed without the prompt that produced it, and until now the only copy lived in
Anthropic's own retention. He chose to keep the prompt and answer of every call for 30 days,
readable by him alone, never images, wiped by erasure, said in the privacy policy.

## Decision

- **`claude_call_content`**, one row per `claude_usage` row, written by `runAssist` beside the
  settle: the instructions, the cached shop context, the request and the model's answer, as text.
- **No image or document is kept.** Each becomes a placeholder such as
  `[image: image/jpeg, 812 KB, not kept]` (`src/lib/claude/transcript.ts`); an unknown block is a
  placeholder too, never serialized.
- **A fetched page is its URL.** `web_fetch` pages run to 20,000 tokens and can quote anything; the
  address is enough to open it again.
- **Best effort.** The write runs in its own savepoint; a failure logs
  `claude_assist.content_not_kept` and changes no answer.
- **30 days** on `created_at`, deleted daily by the privacy cron. `claude_usage` keeps 400 days
  and gains `latency_ms` and `request_id`. What the model read off a photo or PDF is kept as its
  answer; the file never is.
- **A health question is not kept.** A call's `keepTranscript` may replace parts: when
  `inbox_draft` answers `medical: true`, the thread becomes `[message not kept: health question]`
  and the answer goes too unless its reply is empty. Other assists reading that message keep it.
- **DiveDay only, by SQL** ([runbook](../../engineering/claude-call-content-runbook.md)): no
  screen, no shop export, no backup bundle; a diver may ask DiveDay to see it. Backups hold it
  until they expire. A preview fork is not emptied automatically: builds never write to a preview
  database.
- **Every erasure forgets.** `forgetClaudeCallContent` deletes the shop's rows and stamps the
  shop's erasure time, under a lock the write shares; a call whose words were read (`readAt`)
  before the stamp, less 15 minutes, keeps nothing. The text is keyed to nobody, so no match finds
  one person's words reliably.

## Alternatives considered

- **Keep nothing** (the earlier rule): every bad answer stays a guess.
- **Keep fetched page bodies for the shop's own site**: large, and the URL already reaches them.
- **Put it in a shop's export**: it is DiveDay's working log about its own model calls, not the
  shop's record, and shipping diver words out of DiveDay widens who can read them.

## Consequences

The privacy policy's Anthropic entry and retention list say what is kept and who reads it. A new
assist inherits the copy with no extra work; a prompt that would put something in it that should
never be stored (a medical answer, the crew's medical alert, the waiver records table) is refused
by `check:assist-prompts`.
