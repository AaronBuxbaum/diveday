import { MARK_CORAL, MARK_FOAM, MARK_GRADIENT } from "./colors";

/**
 * **The bubble-trail mark, at any size, for the bitmaps a browser asks for.**
 *
 * `ImageResponse` runs satori outside the themed component tree, so it cannot
 * read `globals.css`'s custom properties. The values come from `./colors`,
 * which is the one module allowed to hold them literally.
 *
 * Every value is a fraction of `size` rather than a pixel, because the same
 * mark now has to be a 32px favicon and a 512px launcher tile, and the original
 * hand-placed 32px coordinates do not survive being multiplied by sixteen —
 * they were tuned by eye at one size.
 */

export function BubbleMark({ size, maskable = false }: { size: number; maskable?: boolean }) {
  // **Android's safe zone is the inner 80% of the diameter of a circle
  // inscribed in the icon**, so a maskable icon has to assume everything
  // outside that is cropped away by whatever shape the launcher uses. The mark
  // is drawn into that inner square and the brand colour fills the rest, which
  // is what turns a letterboxed white circle with a shrunken logo into a tile
  // the launcher can cut any shape out of. `docs/design/brand.md` specifies the
  // clear space the mark wants; this is that, expressed as the platform's rule.
  const inset = maskable ? size * 0.2 : 0;
  const artwork = size - inset * 2;
  const unit = artwork / 32;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        background: MARK_GRADIENT,
        // A maskable icon must bleed to the edge — the launcher supplies the
        // corner. A favicon keeps the rounded square it has always had, scaled.
        borderRadius: maskable ? 0 : unit * 7,
      }}
    >
      {[
        { left: 3, top: 15, diameter: 12, fill: MARK_FOAM, opacity: 1 },
        { left: 13, top: 8, diameter: 8, fill: MARK_FOAM, opacity: 0.85 },
        { left: 21, top: 4, diameter: 5, fill: MARK_CORAL, opacity: 1 },
      ].map((bubble) => (
        <div
          key={`${bubble.left}-${bubble.top}`}
          style={{
            position: "absolute",
            left: inset + bubble.left * unit,
            top: inset + bubble.top * unit,
            width: bubble.diameter * unit,
            height: bubble.diameter * unit,
            borderRadius: 999,
            background: bubble.fill,
            opacity: bubble.opacity,
          }}
        />
      ))}
    </div>
  );
}
