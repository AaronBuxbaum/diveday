# H-20261014-checkouts-reach-the-books: How do online checkouts and tips reach a shop's books?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**When an online checkout, a tip or a checkout refund is sent to QuickBooks, Xero or Zapier, what shape does it take?** Before batch 6 only orders reached them, so most card revenue never did.

## Minimum outcome to record

One receipt per checkout or per seat; where a tip lands.

## Outcome

**Built with the recommended answer (batch 6 item 9, 2026-10-14), awaiting confirmation:**

- **One receipt per checkout**, not per seat, with the party lead as the customer and fare, gear and pass-through fees as lines.
- **A tip is income on its own line** ("Tip: <trip>"), its own receipt.
- A checkout refund is one refund receipt per change in the refunded total.

The mechanics are [20261014-checkouts-reach-integrations](../../architecture/decisions/20261014-checkouts-reach-integrations.md).

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
