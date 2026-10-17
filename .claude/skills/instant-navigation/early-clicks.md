# Instant navigation: a static shell paints a control before React owns it

Part of the **instant-navigation** skill ([SKILL.md](SKILL.md)). Read it when a route gains a static shell with a button or form in it, or a spec clicks and nothing happens.

## A static shell paints a control before React owns it

The moment a route gains a static shell, its buttons are on screen and clickable while their
handlers are still on the way. A click that lands in that window is **swallowed in silence** — no
error, no effect, and fifteen seconds later a spec times out on something behind a door that never
opened. It only bites a control whose whole behaviour is client-side (a disclosure opened by React
state, a search that debounces, a toolbar that rewrites the query): a link and an uncontrolled form
work perfectly well without JavaScript, which is why most of the suite never noticed.

This window was closed by accident on `/shop/**` until issue 1446, because nothing painted until
the server had finished. Giving the staff surfaces a shell is what made it real, and the first
thing to find it was `e2e/gear.spec.ts` on a loaded CI shard — measured at 53ms on an idle local
machine, and long enough to fail there.

The answer is the flag this repo already uses: a `hydrated` state set in an effect, published as
`data-hydrated` on the element the suite interacts with (`CheckInSearch`, `OrdersToolbar`,
`CrewSection`, `BookingPartyFields`, …), and `await expect(el).toHaveAttribute("data-hydrated",
"true")` before the click. **Expect to add one whenever you give a surface a shell**, and reach for
it rather than for a wait on something that merely happens to appear later.
