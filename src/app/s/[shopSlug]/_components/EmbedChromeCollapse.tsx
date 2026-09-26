/**
 * The marker on the layout's chrome bar (`PublicShopChromePlaceholder`), the
 * one thing `EmbedChromeCollapse` reaches for.
 */
export const CHROME_PLACEHOLDER_ATTRIBUTE = "data-public-shop-chrome-placeholder";

/**
 * **A framed page's shell draws no chrome bar** (K-382; ADR
 * 20260726-schedule-embed, amendment 2026-09-25). The public layout holds the
 * header band's height in its static shell so that nothing below jumps down
 * when the shop's header streams in. Inside a frame the real chrome is
 * nothing, so there the held band *was* the jump: 57px painted above the
 * frame's skeleton, then gone, taking the whole frame up with it.
 *
 * The layout cannot tell a frame from a page — it sits above both internal
 * segments and reads no query — but the segments are the frame, so each one's
 * skeleton and page render this rule. A `<style>` applies wherever it lands and
 * leaves with the element that rendered it, and between them the skeleton and
 * the page cover every moment from the static shell until the chrome streams
 * in as nothing and takes the bar out of the document.
 */
export function EmbedChromeCollapse() {
  return <style>{`[${CHROME_PLACEHOLDER_ATTRIBUTE}]{display:none}`}</style>;
}
