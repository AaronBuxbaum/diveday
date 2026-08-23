import { LOGO_MARK_CIRCLES, LOGO_MARK_VIEWBOX } from "@/components/Logo";

// i18n-exempt-file: link-preview card chrome rendered for crawlers with no
// visitor locale context, the same carve-out every `opengraph-image.tsx` takes.
/**
 * The chrome every DiveDay link-preview card wears: the deep-ocean gradient,
 * the wordmark, and the tagline footer.
 *
 * There are four cards (`src/app/opengraph-image.tsx`, the shop schedule, one
 * departure, and a shared recap) and their *bodies* are genuinely their own —
 * a headline, a shop name, a trip and price, a recap line. Only the chrome
 * repeats, and repeating it by hand is what let the mark be wrong on all four
 * at once and stay wrong: they render in someone else's chat window, where
 * nobody in this repo ever looks. It drifted again inside the very change that
 * fixed it, when a 40px-to-48px rescale landed on one card and left three
 * behind (FU-20260812). The geometry now has one home
 * (`LOGO_MARK_CIRCLES` in `src/components/Logo.tsx`) and the pixels are
 * derived from it, so there is nothing left to keep in step by hand.
 *
 * Hex literals rather than semantic tokens, deliberately: satori rasterizes to
 * a bitmap with no stylesheet, so CSS custom properties cannot reach here. It
 * is the same exemption Next's metadata filenames carry — this path is named
 * explicitly in `scripts/check-tokens.mjs` for exactly that reason. The values
 * restate the deep-ocean dark palette from `globals.css`; dark works on every
 * chat client's light and dark chrome, which is why the card commits to it.
 */
export const OG_COLORS = {
  /** `--surface` in the deep-ocean dark theme — the card's ground. */
  base: "#071720",
  /** The gradient's far corner, a shade off the ground. */
  baseFar: "#0d222d",
  /** `--foreground`: the headline and the wordmark. */
  ink: "#e9f3f4",
  /** `--muted`: the secondary lines (shop name, dive sites, date). */
  muted: "#9fc0c7",
  /** `--primary`: the two lower bubbles and the footer line. */
  primary: "#22d3ee",
  /** `--accent`: the rationed coral — the top bubble and the full stop. */
  accent: "#ff8a7e",
} as const;

/**
 * The deep-ocean ground every card sits on. Each card keeps its own `size`
 * export — that is Next's metadata contract with the route, not chrome.
 */
export const CARD_STYLE = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column" as const,
  justifyContent: "space-between",
  padding: 72,
  backgroundColor: OG_COLORS.base,
  backgroundImage: `linear-gradient(160deg, ${OG_COLORS.base} 55%, ${OG_COLORS.baseFar} 100%)`,
  color: OG_COLORS.ink,
  fontSize: 32,
};

/**
 * The mark's box on a card: 48px, `LogoMark`'s 24px viewBox at 2x — the same
 * mark-to-wordmark proportion the site header uses (`size-6` beside
 * `text-base`), scaled to a 40px name.
 */
export const OG_MARK_SIZE = 48;

/** One bubble as satori can draw it: an absolutely positioned, fully rounded box. */
export type OgMarkCircle = {
  left: number;
  top: number;
  size: number;
  color: string;
  opacity: number;
};

/**
 * `LOGO_MARK_CIRCLES` in card pixels. A viewBox circle is a center and a
 * radius; a satori bubble is a top-left corner and a diameter, so the
 * conversion is the whole of what used to be copied by hand.
 */
export function ogMarkCircles(box: number = OG_MARK_SIZE): OgMarkCircle[] {
  const scale = box / LOGO_MARK_VIEWBOX;
  return LOGO_MARK_CIRCLES.map((circle) => ({
    left: Math.round((circle.cx - circle.r) * scale),
    top: Math.round((circle.cy - circle.r) * scale),
    size: Math.round(circle.r * 2 * scale),
    color: circle.tone === "accent" ? OG_COLORS.accent : OG_COLORS.primary,
    opacity: circle.opacity,
  }));
}

/**
 * The brand lockup — the bubble-trail mark, "DiveDay", and its coral full
 * stop. The satori twin of `Wordmark` in `src/components/Logo.tsx`; the two
 * share the mark's coordinates but nothing else, because one styles through
 * Tailwind and the other cannot.
 */
export const OG_WORDMARK = (
  <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
    <div
      style={{
        display: "flex",
        position: "relative",
        width: OG_MARK_SIZE,
        height: OG_MARK_SIZE,
      }}
    >
      {ogMarkCircles().map((circle) => (
        <div
          key={`${circle.left},${circle.top}`}
          style={{
            position: "absolute",
            left: circle.left,
            top: circle.top,
            width: circle.size,
            height: circle.size,
            borderRadius: 9999,
            backgroundColor: circle.color,
            opacity: circle.opacity,
            display: "flex",
          }}
        />
      ))}
    </div>
    <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>
      DiveDay
      <span style={{ color: OG_COLORS.accent }}>.</span>
    </div>
  </div>
);

/** The promise DiveDay's *own* cards close on. Never a shop's. */
export const OG_TAGLINE = "A calmer way to run a dive day";

/** A card's bottom line: the tagline, or the one fact that earns the slot. */
export function ogFooter(text: string = OG_TAGLINE) {
  return <div style={{ display: "flex", fontSize: 28, color: OG_COLORS.primary }}>{text}</div>;
}

/**
 * **DiveDay's credit on a card that belongs to somebody else.**
 *
 * The two shop-scoped cards led with the wordmark at 40px and closed with the
 * tagline — so a dive shop posting its own departure to its own audience got a
 * card whose loudest element was its software vendor's logo, and whose last
 * line was that vendor's marketing sentence spliced onto the shop's own "3
 * spots left" with a middot, reading as one claim (issue #810).
 *
 * `docs/design/brand.md` already had the answer: the product may be the actor
 * when it acts on someone's behalf, and "otherwise, let the shop and the
 * user's work stay in the foreground". A shop advertising a boat trip is the
 * clearest case of the shop's own work there is.
 *
 * So the credit stays — the page is hosted here and attribution is honest —
 * but at 22px in muted ink at the foot of the card, the way a venue's name
 * sits on a ticket. Half the mark's size, since it is a credit rather than a
 * lockup, and the bubbles keep their proportions.
 */
export function ogCredit() {
  const box = OG_MARK_SIZE / 2;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: 0.75 }}>
      <div style={{ display: "flex", position: "relative", width: box, height: box }}>
        {ogMarkCircles(box).map((circle) => (
          <div
            key={`${circle.left},${circle.top}`}
            style={{
              position: "absolute",
              left: circle.left,
              top: circle.top,
              width: circle.size,
              height: circle.size,
              borderRadius: 9999,
              backgroundColor: circle.color,
              opacity: circle.opacity,
              display: "flex",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", fontSize: 22, color: OG_COLORS.muted }}>DiveDay</div>
    </div>
  );
}
