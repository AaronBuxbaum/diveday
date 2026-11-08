/**
 * What the public status page is allowed to say, as codes.
 *
 * The page reads two facts and derives a third. It cannot read more than two
 * without becoming a second source of truth beside `infra/lib/observability.ts`,
 * and a status page that disagrees with the alarms is worse than none: the shop
 * owner opening it during an outage is deciding whether to phone us, and a
 * cheerful page they cannot reconcile with a dead app costs them the call.
 *
 * So the rule here is that every component is something the page **observes in
 * the act of rendering**, never something it was told. `serving` is true
 * because the reader is looking at a server-rendered page; `database` is true
 * because a query round-tripped a moment ago. Nothing is cached, nothing is
 * reported from a dashboard, and there is no hand-operated "we are aware of an
 * issue" switch — that is the mode in which a status page lies.
 *
 * Codes, not sentences (AGENTS.md): the words live in the message bundles.
 */

/** Each thing the page reports on, in the order it is shown. */
export const PLATFORM_COMPONENTS = ["serving", "database"] as const;

export type PlatformComponentId = (typeof PLATFORM_COMPONENTS)[number];

/**
 * `up` — checked just now and answering.
 * `down` — checked just now and did not answer.
 *
 * Deliberately two states and no `unknown`: every component here is checked
 * during the render that produces the page, so "we could not tell" is not a
 * reachable answer. A component that ever needs a third state is a component
 * being reported from somewhere other than this request, which is the design
 * this module exists to refuse.
 */
export type PlatformComponentState = "up" | "down";

export interface PlatformComponent {
  readonly id: PlatformComponentId;
  readonly state: PlatformComponentState;
}

/**
 * `ok` — everything answered.
 * `degraded` — some answered, some did not.
 * `down` — nothing answered.
 *
 * `down` is unreachable in practice from the page itself, since `serving` is up
 * whenever there is a page at all; it exists because the function is total over
 * its input and a summary that could not express "all of it is gone" would be
 * the wrong shape for the external monitor to grow into.
 */
export type PlatformStatus = "ok" | "degraded" | "down";

export function overallPlatformStatus(components: readonly PlatformComponent[]): PlatformStatus {
  if (components.length === 0) return "down";
  const up = components.filter((component) => component.state === "up").length;
  if (up === components.length) return "ok";
  return up === 0 ? "down" : "degraded";
}
