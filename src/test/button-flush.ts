import { type ButtonSize, type ButtonVariant, buttonClass } from "@/components/ui/button";

/**
 * Whether a rendered control wears `flush` for its variant and size.
 *
 * Asked of `buttonClass` itself rather than spelled as its tokens: a test that
 * pins `-mx-2 px-2` or `px-0` restates how `flush` is built today, and breaks
 * the day that changes while the label still sits on its column. This reads
 * the difference `flush` makes to that variant and size — the tokens it adds,
 * the tokens it drops — and checks the element carries exactly that side of
 * it. jsdom has no layout, so this is as close to "the label is on the column"
 * as a unit test gets.
 */
export function rendersFlush(element: Element, variant: ButtonVariant, size: ButtonSize) {
  // `flush` is typed `false` on a variant painted at rest. The union here is
  // wider than any one call site, and a painted variant, which `flush` leaves
  // alone, has no difference to find and fails the check.
  const flush = buttonClass({ variant, size, flush: true as never }).split(" ");
  const plain = buttonClass({ variant, size }).split(" ");
  const adds = flush.filter((token) => !plain.includes(token));
  const drops = plain.filter((token) => !flush.includes(token));
  if (adds.length === 0 && drops.length === 0) return false;
  return (
    adds.every((token) => element.classList.contains(token)) &&
    drops.every((token) => !element.classList.contains(token))
  );
}
