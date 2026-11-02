/**
 * **Active sessions, one row per device** (visual review 2026-10-24, A03).
 *
 * A staffer who signs in from the same laptop every morning collects a session
 * a day, and the list read as thirty identical "Chrome · Linux" rows. Rows
 * whose device label (browser and platform, the words the page already
 * renders) is the same collapse into one group. The group holding the session
 * this request is using comes first; the rest follow by the latest time any of
 * their sessions was seen, newest first, and so do the sessions inside each
 * group. Grouping changes only what is drawn: every session keeps its own
 * Revoke, inside its group's disclosure.
 */
export type GroupableSession = {
  id: string;
  /** "Chrome · Linux", or the unknown-device word; the group's key and its name. */
  deviceLabel: string;
  isCurrent: boolean;
  lastSeenAt: Date;
};

export type SessionGroup<T extends GroupableSession> = {
  deviceLabel: string;
  /** One of these sessions is the one reading the page. */
  isCurrent: boolean;
  /** The latest `lastSeenAt` among the sessions. */
  lastSeenAt: Date;
  /** Newest first. */
  sessions: T[];
};

/** How many groups show before "Show all". */
export const SESSION_GROUPS_SHOWN = 5;

export function groupSessions<T extends GroupableSession>(rows: readonly T[]): SessionGroup<T>[] {
  const byLabel = new Map<string, T[]>();
  for (const row of rows) {
    const group = byLabel.get(row.deviceLabel);
    if (group) group.push(row);
    else byLabel.set(row.deviceLabel, [row]);
  }
  const groups = Array.from(byLabel, ([deviceLabel, sessions]) => {
    const sorted = [...sessions].sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
    return {
      deviceLabel,
      isCurrent: sorted.some((session) => session.isCurrent),
      lastSeenAt: sorted[0].lastSeenAt,
      sessions: sorted,
    };
  });
  return groups.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
  });
}

/**
 * **Which words a group's row says about this device** (dive-domain review,
 * visual review 2026-10-24). "This device" marks a session, so on a row that
 * stands for several it would claim every one of them; that row says
 * "Includes this device", and only a group of one may carry "This device".
 */
export function groupDeviceTag(
  group: Pick<SessionGroup<GroupableSession>, "isCurrent" | "sessions">,
): "thisDevice" | "includesThisDevice" | null {
  if (!group.isCurrent) return null;
  return group.sessions.length === 1 ? "thisDevice" : "includesThisDevice";
}
