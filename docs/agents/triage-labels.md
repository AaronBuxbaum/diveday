# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`              | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`                | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`           | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`           | `ready-for-human`    | Requires human implementation            |
| `wontfix`                   | `wontfix`            | Will not be actioned                     |

Beyond the five canonical roles this repo also uses `parked`, `waiting-on-external` (both described in AGENTS.md's `pnpm check:follow-ups` row) and **`in-progress`** — a session is implementing the issue right now. `in-progress` is not a triage state and never replaces one: an issue keeps `ready-for-agent` while it is being worked. See [issue-tracker.md](issue-tracker.md)'s "Claiming an issue".

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.
