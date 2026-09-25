import type { FunnelSource } from "@/lib/funnel";

/**
 * Names the page a demo form was submitted from, for the `demo_entered` event.
 * A component rather than a bare hidden input so the tag is type-checked
 * against the funnel vocabulary — a misspelled one is a build error, not a
 * phantom bucket in the analytics (see `src/lib/funnel.ts`). The set-up half of
 * the funnel is a mail to the onboarding inbox, which carries no tag.
 */
export function FunnelTag({ source }: { source: FunnelSource }) {
  return <input type="hidden" name="source" value={source} />;
}
