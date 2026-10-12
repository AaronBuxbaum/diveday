import { tapTargetLinkClass } from "@/components/ui/button";

/**
 * **"Open trip" is a 44px target on a 20px line** (K-389). The notices drew
 * it as a plain underlined word, 61.8×20px. The link takes
 * `tapTargetLinkClass`, and this wrapper is exactly one `text-sm` line tall,
 * so the 44px box spills 12px above and below without moving the line
 * (`EYEBROW_TAP_WRAPPER`'s idiom, a line box round a larger target). A flex
 * item of the danger row or inline in an owed row's text, the wrapper stands
 * on the line's baseline by the link's words.
 */
export const OPEN_TRIP_LINE = "inline-flex h-5 items-center";
export const OPEN_TRIP_LINK = `${tapTargetLinkClass} font-medium text-primary underline underline-offset-2`;

/**
 * **A notice's rows stand at least a target apart** (K-389). Each "Open trip"
 * box spills 12px above and below its 20px line, so at `space-y-2` two
 * one-line rows stood 28px apart and their boxes crossed by 16px: the later
 * link paints over the earlier and took a click on the earlier one's
 * underline, opening the next diver's departure. A 20px line and a 24px gap
 * is the 44px target, so two rows' spills meet and never cross. Both lists
 * take it: an unconfirmed payment with no Stripe id yet is a one-line row too.
 */
export const NOTICE_ROWS = "mt-3 space-y-6 text-sm";

/**
 * A notice row's separator, bound by a no-break space to the word before it,
 * so a wrapped line ends after a dot and never opens on one (K-569).
 */
export const FACT_SEPARATOR = "\u00A0· ";
