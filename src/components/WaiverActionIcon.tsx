// i18n-exempt-file: pure SVG artwork — every node is aria-hidden path data, no
// words; each control's own label carries the accessible name.

/**
 * The four ways a shop can put a release in a diver's hands: mail it, text it,
 * copy the link and pass it on, or record the paper copy they already signed.
 *
 * One family drawn on a 24px grid at one stroke weight, so the diver record's
 * action row reads as four faces of one control rather than four borrowed
 * pictures. Always `aria-hidden`: the button's own words are the accessible
 * name — an icon-only waiver action would be a guess at the dock, and this row
 * is where a staffer decides how to reach somebody standing in front of them.
 */
export type WaiverActionIconName = "email" | "text" | "link" | "paper";

const ICON_PATHS: Record<WaiverActionIconName, React.ReactNode> = {
  // An envelope, flap down.
  email: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="m21 7-8.47 5.38a1 1 0 0 1-1.06 0L3 7" />
    </>
  ),
  // A speech bubble: the message, not the handset — texting is the errand.
  text: (
    <>
      <path d="M20 4H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2v4l4.5-4H20a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z" />
      <path d="M7.5 9.5h9" />
      <path d="M7.5 13h5.5" />
    </>
  ),
  // Two links of a chain.
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>
  ),
  // A sheet with a signature line and a tick: paper, already signed.
  paper: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="m8.5 15 1.75 1.75L14 13" />
    </>
  ),
};

export function WaiverActionIcon({ name }: { name: WaiverActionIconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4 shrink-0"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/**
 * The mark a delivery button wears for what we last knew about that channel:
 * a tick for a send that left, a cross for one that did not, a bar for a
 * channel this deployment cannot use at all.
 *
 * Three *shapes*, not three colours. The ring around the button is the thing a
 * staffer notices across a counter, and it is colour — so the mark inside has
 * to survive being read in grey (design principle 6). Drawn on the same 24px
 * grid at the same stroke weight as the channel icons beside them, at two
 * thirds the size, so a button reads as one object with a state rather than two
 * pictures.
 */
export type WaiverDeliveryMarkName = "sent" | "copied" | "failed" | "unavailable";

const MARK_PATHS: Record<WaiverDeliveryMarkName, React.ReactNode> = {
  sent: <path d="m5 12.5 4.5 4.5L19 7" />,
  // Two offset sheets — a copy, not a tick. The shape is the whole point:
  // "copied" and "sent" must be told apart by someone the ring's hue does
  // not reach, and a tick in any colour reads as delivered.
  copied: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a1 1 0 0 1 1-1h9" />
    </>
  ),
  failed: (
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>
  ),
  unavailable: <path d="M5 12h14" />,
};

export function WaiverDeliveryMark({ name }: { name: WaiverDeliveryMarkName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3 shrink-0"
    >
      {MARK_PATHS[name]}
    </svg>
  );
}
