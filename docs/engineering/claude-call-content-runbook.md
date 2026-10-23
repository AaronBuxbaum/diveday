# Claude call content runbook

How the founder reads what a Claude assist was sent and what it answered, to find out why it
answered that way. Decision:
[ADR 20261023-claude-call-content](../architecture/decisions/20261023-claude-call-content.md).

## What is kept

Every call `runAssist` (`src/db/assists.ts`) sends writes two rows:

| Table | Holds | Kept |
| --- | --- | --- |
| `claude_usage` | shop, feature code, model, outcome and error codes, tokens, cost, `latency_ms`, `request_id` | 400 days |
| `claude_call_content` | `system_text`, `context_text`, `content_text`, `answer_text`, `fetched_urls` | 30 days |

- **Images and documents are never kept.** `content_text` shows each one as a placeholder such as
  `[image: image/jpeg, 812 KB, not kept]` (`src/lib/claude/transcript.ts`).
- **Fetched pages are never kept.** `fetched_urls` lists the pages `web_fetch` read, one per line;
  open the URL to see the page.
- `answer_text` is the model's last text block as it came back, before validation: empty on a
  refusal, null when the call failed. `claude_usage.outcome` says which.
- A content row that could not be written leaves a `claude_assist.content_not_kept` log line with
  the feature, shop id and reason, and the assist answers as usual.

## Who can read it

The founder only, by SQL in the Neon console. No staff screen, no shop export
(`src/db/export-shop-files.ts`) and no per-shop backup bundle reads it. Neon's point-in-time
recovery and the weekly full-cluster dump carry it like every table, until the 30-day prune and
their own windows age it out ([backup runbook](backup-and-restore-runbook.md)).

The text quotes divers: inbox messages, a duplicate check's names and dates of birth, gear notes,
reviews. Read it to fix an assist, and copy none of it anywhere else.

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
