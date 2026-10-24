# Claude call content runbook

How the founder reads what a Claude assist was sent and what it answered, to find out why it
answered that way. Decision:
[ADR 20261023-claude-call-content](../architecture/decisions/20261023-claude-call-content.md).

## What is kept

Every call `runAssist` (`src/db/assists.ts`) sends writes two rows:

| Table | Holds | Kept |
| --- | --- | --- |
| `claude_usage` | shop, feature code, model, outcome and error codes, tokens, cost, `latency_ms`, `request_id` | 400 days |
| `claude_call_content` | `system_text`, `context_text`, `content_text`, `answer_text`, `fetched_urls` | 30 days, deleted daily |

- **Images and documents are never kept.** `content_text` shows each one as a placeholder such as
  `[image: image/jpeg, 812 KB, not kept]` (`src/lib/claude/transcript.ts`). What the model read
  off one is kept in `answer_text`: a card's agency, level and number, or a waiver PDF's text.
- **The 30 days are real.** The daily privacy cron (`/api/cron/dietary-retention`, 03:09 UTC)
  deletes rows past 30 days (`drainExpiredClaudeCallContent`); the weekly prune reaches the table
  too. Its log lines are `cron_claude_content_retention.prune_failed` and `…prune_capped`.
- **Fetched pages are never kept.** `fetched_urls` lists the pages `web_fetch` read, one per line;
  open the URL to see the page.
- `answer_text` is the model's last text block as it came back, before validation: empty on a
  refusal, null when the call failed. `claude_usage.outcome` says which.
- A content row that could not be written leaves a `claude_assist.content_not_kept` log line with
  the feature, shop id and reason, and the assist answers as usual.

## Who can read it

DiveDay only: no staff screen, no shop export (`src/db/export-shop-files.ts`) and no per-shop
backup bundle reads it. In practice that is whoever holds production database access, today the
founder, by SQL in the Neon console. Backups hold a copy until they expire: the weekly full-cluster
dump after 35 days, Neon's point-in-time recovery after its own window, which the
[backup runbook](backup-and-restore-runbook.md) has yet to record. The privacy policy says "until
they expire" and names no number for that reason.

**Preview databases.** A Neon branch forked from production carries the table like every other.
Git preview deployments are off (`vercel.json`, `git.deploymentEnabled`), and the build never
writes to a preview database (ADR 20260718-vercel-neon-hosting), so nothing empties it there
automatically. Before handing a production fork to anyone or any preview code, run
`truncate claude_call_content;` on that branch.

**Erasure.** Every erasure path (`anonymizeDiver`, `eraseGuardianEmail`) calls
`forgetClaudeCallContent`: it deletes the shop's rows and stamps
`claude_call_content_erasures`. A call whose words were read before that stamp (less 15 minutes)
keeps nothing, however late it finishes.

The text quotes divers: inbox messages, a duplicate check's names and dates of birth, gear notes,
reviews. Read it to fix an assist, and copy none of it anywhere else.

## A health question

When `inbox_draft` answers `medical: true`, its row keeps `[message not kept: health question]` in
`content_text`, and keeps `answer_text` only when the drafted reply is empty
(`keepUnlessHealth`, `src/lib/assists/inbox.ts`). The inbox's sort and translate calls on the same
message keep it as written.

## A request to see or delete it

A diver, or anyone a shop's messages may have quoted, can ask DiveDay what is kept. Answer from the
shop's rows: search `content_text` and `answer_text` for their name, address or phone with
`ilike`, and send them what matches.

A person with no diver record (a stranger who emailed, a walk-up who scanned a card and left) has
no erasure button. Their words go at 30 days. When they ask sooner, delete the shop's rows by hand
(`delete from claude_call_content where shop_id = …;`), which is what an erasure does.

## The last calls for a shop

Set the shop's slug, and optionally a feature code (`inbox_draft`, `cert_scan`, …), in the first
lines.

```sql
with params as (select 'blue-mantis'::text as shop_slug, null::text as feature, 20 as how_many)
select u.created_at, u.feature, u.model, u.outcome, u.error_code, u.latency_ms, u.request_id, u.input_tokens, u.output_tokens, u.cost_micro_usd, c.system_text, c.context_text, c.content_text, c.answer_text, c.fetched_urls
from claude_usage u
join shops s on s.id = u.shop_id
left join claude_call_content c on c.usage_id = u.id
cross join params p
where s.slug = p.shop_slug and (p.feature is null or u.feature = p.feature)
order by u.created_at desc
limit (select how_many from params);
```

A usage row with no content row is older than 30 days, from before 2026-10-23, from a shop where a
diver was erased since (or within the few minutes before the call: a call that overlaps an erasure
keeps nothing, so an erased diver's words cannot land after the delete), or one whose content write
failed. The log line `claude_assist.content_not_kept` says which with `reason`: `erasure` or
`write_failed`.

## Asking Anthropic about a call

`claude_usage.request_id` is Anthropic's `request-id` for the call's last request. Quote it to
Anthropic support for a slow, failed or odd call; it is the only identifier they need.
