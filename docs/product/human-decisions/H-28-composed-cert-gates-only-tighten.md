# H-28: Composed cert gates can only tighten.

- **Status:** Chosen
- **Human owner:** Product owner + operations lead

## Decision or approval needed

**Composed cert gates can only tighten.** A trip's requirement and every dive site it visits fold into one gate by taking the *stricter* level and the *union* of specialties (`combineCertRequirements`) — a shop can add to what a site demands but can never subtract. That makes a real Florida Keys pattern unsellable: a mixed-level two-tank on the Spiegel Grove (deck at 13 m, sand at 40 m) is an ordinary charter an Open Water diver dives shallow with a buddy, but because the site is marked `advanced_open_water`, admission now refuses every Open Water diver **at the sale** unless the shop unmarks the site for every other charter it runs. Options: leave as is (shops split the trip in two); allow a trip to state a level *below* its site's, recorded as a deliberate override with the depth advisory still raised; or make the site gate advisory-only and let the trip's own row be the gate.

## Minimum outcome to record

Whether a trip may state a gate looser than one of its dive sites, and if so what is recorded (who overrode, and whether readiness still blocks).

## Unblocks / follow-up

**Decided 2026-08-20: yes** — a trip may state a certification gate *below* the strictest of its dive sites, recorded as a deliberate override rather than inferred from a blank field, with the depth advisory still raised and **readiness unchanged** (boarding-time still enforces the stricter of the two; the override moves the *sale*, not the water). A shop that runs the Spiegel Grove as a mixed-level two-tank stops having to unmark the site for every other charter. Still to build: the override column and its actor, `combineCertRequirements` learning to be told, and the trip requirements editor saying so in words a staffer will read. The same conversation opened a larger one the owner asked to be scoped rather than built — **the people aboard who are not diving**: snorkellers and boat riders, who carry different prices, different gates and the same head count. That is scoped at [features/participant-types.md](../features/participant-types.md) and is deliberately *not* an answer to this row: an Open Water diver on an advanced site is diving, and recording them as a snorkeller to clear the gate would be a lie in the record the crew reads at the rail. Unblocks mixed-level charters on gated sites. Touches `combineCertRequirements`, the readiness composition, and the trip requirements editor.

Part of the [human decision log](README.md#decision-register).
