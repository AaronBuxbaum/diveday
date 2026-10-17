# Copy restraint: accessibility is not the tiebreaker

Part of the **copy-restraint** skill ([SKILL.md](SKILL.md)). Read it when a more accessible option and a more delightful one genuinely conflict, before choosing.

## Accessibility is not the tiebreaker

When a more accessible option and a more delightful one for the standard user genuinely conflict,
**build the delightful one** and record the trade in
[docs/design/accessibility-tradeoffs.md](../../../docs/design/accessibility-tradeoffs.md) — a
register a human revisits later, never a follow-up entry and never a silent omission.

This is narrow and it is not a licence:

- It applies to **copy and presentation** choices — a helper sentence, a visible hint, a caption
  restating a colour. It does not license removing a control from the keyboard, breaking focus
  order, or shipping a target under 44 px.
- **Safety surfaces are exempt.** Manifests, roll call, cert gating, and medical flags keep
  [principle 6](../../../docs/design/principles.md) whole: never colour alone, states in words,
  timestamps with their zone. A crew member reading a wet screen in glare is the standard user
  there.
- An `aria-label` costs the sighted reader nothing, so it is never the thing traded away. What
  gets traded is *visible* prose — and when it goes, the accessible name is what has to carry the
  meaning instead.

Every trade goes in the register with what was dropped, who it costs, and what would reverse it.
An unrecorded trade is a bug.
