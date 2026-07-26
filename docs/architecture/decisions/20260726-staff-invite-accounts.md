# 20260726-staff-invite-accounts — Owner/manager-issued staff invites over the existing account-token seam

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

`/onboard` is the only way to get a DiveDay login — it creates exactly one owner account per
shop. Every other staff role (manager, instructor, divemaster, captain, crew) has no self-serve
way to get one; in practice they'd have to be hand-inserted into the database. This gap was named
twice already: [20260725-account-lifecycle-emails](20260725-account-lifecycle-emails.md)'s
Consequences flagged it explicitly ("there's no staff-invite flow yet... `account_tokens`'
`purpose` enum can grow an `invite` value later without a new table"), and
`docs/product/rollout.md` lists "staff accounts" as a Week-0 pilot requirement. H-14
([20260724-role-authorization](20260724-role-authorization.md)) already established the
owner/manager-gated-surface pattern this slots into.

## Decision

**Reuse the `account_tokens` seam exactly as anticipated.** `account_token_purpose` gains
`invite`; no new table. An invite mints a `user_accounts` row immediately (so the team list can
show it right away) with a fresh `accountStatus` value, `invited`, and an unusable random
bcrypt hash — never handed to anyone. `verifyCredentials`, `loadActiveStaffRoles`, and
`findActiveAccountByEmail` already gate on `status === "active"`, so an invited account is
automatically excluded from sign-in, staff-role checks, and password-reset requests with **no
code changes** to any of them. The one seam that does need a change: `consumeAccountToken`'s
re-check moves from `status === "active"` to `status !== "disabled"`, so an invite token can be
consumed by its own `invited` account — a disabled account's tokens still stop working
immediately, preserving the original security-review invariant (a stricter, not a looser, check:
`disabled` was always meant to be the one blocking state).

Accepting an invite at `/invite/[token]` (same shape as `/verify/[token]` and
`/reset-password/[token]`: no mutation on the bare GET, only the form submit consumes the
one-time token) sets the invitee's own password, flips the account to `active`, and stamps
`emailVerifiedAt` — clicking a link mailed to that address is the same email-ownership proof
`email_verification` records, so there is no reason to make the invitee verify twice.

**Management surface:** `canManageStaffAccounts` (owner/manager, `src/lib/authz.ts`) gates a new
`/shop/[shopSlug]/settings/team` page — inviting, editing a person's roles, resending a stale
invite, and disabling/removing access all take this one gate, the same accountability weight as
payment settings and refunds (H-14). Role-grant scope is deliberately unrestricted within that
gate: an owner/manager may assign any staff role, including `owner`, to a new or existing team
member — the codebase has no existing concept of "who may grant `owner`" and inventing one here
would be scope creep the product owner hasn't asked for.

**Reusing an existing person.** If the shop already has an active (non-deleted) person at that
email — most commonly a regular diver who's about to start crewing — the invite attaches the new
roles and the account to *that* person rather than forking a second record, per the glossary's
"model roles, not separate person types" rule. If that person already has a `user_accounts` row,
the invite is refused (`already_on_team`) rather than silently duplicating. `user_accounts.email`
is globally unique (pre-existing constraint), so an email already registered to a *different*
shop's account is refused too (`email_registered_elsewhere`), mirroring `/onboard`'s existing
slug/email-taken checks.

**The one lockout guard.** A person may never lose the `owner` role, be disabled, or be removed
from the team if doing so would leave the shop with zero people holding `owner`. This is
deliberately narrow — it does not generalize to "the shop needs N active staff" or protect any
other role — because `owner` is the one role every shop is guaranteed to start with
(`/onboard` always grants it) and the one whose total absence has no recovery path short of a
support ticket.

**Removing someone** strips every `STAFF_ROLES` row for that person (a `diver` row, if any, is
untouched — staff-ness and diver-ness are independent facts about the same person) and disables
the account. It never soft-deletes the `people` row — that's the separately-gated `canDeleteDiver`
action, for a different purpose (removing a *diver* from the roster, not revoking a login).

**Every mutation re-verifies tenant ownership inside its own transaction, not just in the
last-owner guard.** A `security-reviewer` pass caught that the first cut of `setStaffRoles`,
`setStaffAccountStatus`, and `removeStaffMember` scoped `isLastOwner`'s *count* to `shopId` but
wrote to `person_roles`/`user_accounts` by bare `personId`/`userAccountId` — since neither table
carries its own `shop_id` column, a mismatched id from a different shop would silently pass
`isLastOwner` (it just returns `false`, not "not this shop") and the write would proceed
unchecked, letting one shop's owner/manager edit another shop's roster by supplying a foreign
person/account id in the request. Fixed with `personInShop`/`staffAccountInShop` guards that run
first, inside the same transaction, and refuse (`not_found`) before any write when the id doesn't
resolve to a live person (and, for account-status/removal, the *same* person's own account) in
the acting shop.

## Alternatives considered

- **A new `staff_invites` table** instead of reusing `account_tokens` — more explicit, but the
  prior ADR already reasoned through this exact case and concluded the generic token shape fits;
  a second bearer-token table for the same purpose would just be duplication.
- **Create the `user_accounts` row only on acceptance**, keeping the invite as a bare token with
  no account behind it yet — avoids the `invited` status entirely, but then the team list can't
  show a pending invite (no row to show), and the accept flow would need to create the person,
  roles, *and* account inside the token-consumption transaction, which is a much larger
  transaction to get right under concurrency than "flip an existing row's status."
- **Gate sign-in with a dedicated `pending` boolean instead of a third `accountStatus` value** —
  rejected because every sign-in/role-check call site already branches on `status`, and a second
  independent boolean would mean two things to keep in sync instead of one enum with an obvious
  ordering.

## Consequences

Shops can now staff up without a database console. The `invited` status join point means every
place that already checked `status === "active"` (`verifyCredentials`, `loadActiveStaffRoles`,
`findActiveAccountByEmail`, the export/import/reporting gates) needed zero changes — the new state
was free to add because "not active" already meant "can't do anything" everywhere it mattered.
Role-grant authority is intentionally flat (any owner/manager can grant `owner`); if abuse or a
support incident ever makes that too permissive, narrowing it is an `authz.ts` predicate change,
not a schema change. The last-owner guard is narrow by design — it does not protect against a
shop disabling its entire staff down to zero, only against losing every `owner`; broadening it is
future work if a real incident calls for it.
