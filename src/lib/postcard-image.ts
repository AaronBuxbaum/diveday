/**
 * **The keepsake, as a picture** — issue #1081, slice 16i of ADR
 * 20260904-reef-all-the-way-down.
 *
 * The recap has no share control and cannot have one: `/ready/[token]` renders
 * the same surface from a bearer URL that can cancel a booking and move its
 * refund (see `AfterState`'s doc comment, and
 * docs/engineering/capability-telemetry-runbook.md). So the thing a diver
 * shares is not a link — it is an image, drawn in the browser from facts that
 * have already been worded, with **no URL in it at all**.
 *
 * That absence is structural rather than careful. `PostcardImage` has no
 * `url`, `href`, `token`, `slug` or `path` field of any kind, so the drawing
 * below has nothing to write even if a later change asked it to; the type is
 * the proof, and `postcard-image.test.ts` asserts it against the drawing's
 * actual output rather than against a promise in a comment.
 *
 * **This module holds no copy.** Every string on the card arrives as a
 * parameter, already in the reader's language and already formatted in the
 * shop's zone by the caller (`buildAfterStateProps`) — `src/lib` returns codes,
 * not sentences (ADR 20260731-domain-layer-copy-leaks), and a canvas cannot
 * reach a message bundle anyway.
 *
 * It is also framework-free and takes its colours as parameters, so the one
 * decision it does not make is which palette to draw. `SavePostcard.tsx` reads
 * that off the live document and says there why.
 */

/**
 * The frame, in CSS pixels: 4:5 portrait, which is what a phone's share sheet,
 * an Instagram post and a message thread all crop to without cutting the card.
 * Fixed whatever the content, because a keepsake of a two-site day and a
 * keepsake of a one-site day should be the same object.
 */
export const POSTCARD_FRAME = { width: 1080, height: 1350 } as const;

/** One recorded fact of the day, already worded and already formatted. */
export type PostcardFact = { label: string; value: string };

/**
 * Everything the picture says, and nothing else. Note what is absent: no URL,
 * no token, no shop slug, no booking id — see this module's doc comment.
 */
export type PostcardImage = {
  /** The shop's own name, which is the card's eyebrow. */
  shopName: string;
  /** The record's heading, in the shop's words for it ("Dive log entry"). */
  heading: string;
  /** "Dive day № 3", or the milestone's own sentence on a milestone visit. */
  diveDayLine: string;
  /** The same rows `DiveRecord` renders, in the same order. */
  facts: PostcardFact[];
  /** What the diver typed for themselves, or null when they typed nothing. */
  privateLine: string | null;
  /** "Recorded by Blue Mantis Divers" — the one claim the card makes of itself. */
  recordedBy: string;
};

/**
 * Six resolved colour strings, read off the live document by the caller. No
 * token names and no hex live here: this module never decides a colour, it only
 * uses the ones it is handed (ADR-0004).
 */
export type PostcardPalette = {
  /** The card's ground. */
  surface: string;
  /** The band across the top, behind the heading and the drawing. */
  band: string;
  /** Body ink. */
  ink: string;
  /** The quieter ink a label and the footer take. */
  muted: string;
  /** The shop's own accent, on the eyebrow and the dive-day line. */
  accent: string;
  /** Hairlines between the facts. */
  rule: string;
};

const PAD = 72;
const BAND_HEIGHT = 300;

/**
 * Draw the whole card. Synchronous and total: it returns having painted every
 * pixel of `POSTCARD_FRAME`, whatever it was handed — a null `mark` draws the
 * band without the drawing rather than leaving a hole, and a private line long
 * enough to overrun the frame wraps rather than running off the edge.
 *
 * The caller sets any device-pixel scaling on the context before calling; this
 * draws in CSS pixels throughout so the layout is the same at 1x and 2x.
 */
export function drawPostcard(
  ctx: CanvasRenderingContext2D,
  postcard: PostcardImage,
  palette: PostcardPalette,
  mark: CanvasImageSource | null,
): void {
  const { width, height } = POSTCARD_FRAME;

  ctx.fillStyle = palette.surface;
  ctx.fillRect(0, 0, width, height);

  // ——— The band: the shop's name, the record's heading, and the day's drawing.
  ctx.fillStyle = palette.band;
  ctx.fillRect(0, 0, width, BAND_HEIGHT);

  if (mark) {
    // The live `SiteMark` tile, borrowed rather than redrawn — one hand, one
    // drawing, and no second copy of the illustration set to keep in step.
    ctx.drawImage(mark, width - PAD - 240, BAND_HEIGHT / 2 - 84, 240, 168);
  }

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = palette.accent;
  ctx.font = `600 30px ${SANS}`;
  ctx.fillText(postcard.shopName, PAD, 132);

  ctx.fillStyle = palette.ink;
  ctx.font = `700 58px ${SANS}`;
  ctx.fillText(postcard.heading, PAD, 206);

  ctx.fillStyle = palette.accent;
  ctx.font = `600 34px ${SANS}`;
  ctx.fillText(postcard.diveDayLine, PAD, 258);

  // ——— The facts, one hairline-separated row each, in the record's own order.
  //
  // **Every value wraps.** A shop's conditions line is free text and routinely
  // outruns the measure; drawn on one line it walks off the right edge of a
  // picture somebody is about to share, silently, because canvas clips nothing
  // and reports nothing. Wrapping is what makes a long value a taller row
  // instead of a truncated fact.
  const measure = width - PAD * 2;
  let y = BAND_HEIGHT + 88;
  for (const fact of postcard.facts) {
    ctx.fillStyle = palette.muted;
    ctx.font = `600 26px ${SANS}`;
    ctx.fillText(fact.label, PAD, y);

    ctx.fillStyle = palette.ink;
    const valueLines = wrapText(ctx, fact.value, measure, `500 38px ${SANS}`);
    valueLines.forEach((line, index) => {
      ctx.fillText(line, PAD, y + 50 + index * 46);
    });

    y += 74 + valueLines.length * 46;
    ctx.fillStyle = palette.rule;
    ctx.fillRect(PAD, y - 34, measure, 1);
  }

  // ——— The diver's own line, if they wrote one. **No line, no row**: an empty
  // dashed rule with nothing on it would be the card apologising for a blank.
  //
  // It sits directly under the facts rather than pinned to the foot, so a card
  // with three facts is not two thirds white space — the frame is fixed and the
  // content is what it is.
  if (postcard.privateLine) {
    const lines = wrapText(ctx, postcard.privateLine, measure, `italic 400 40px ${SANS}`);
    const top = y + 46;
    ctx.strokeStyle = palette.rule;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(PAD, top - 44);
    ctx.lineTo(width - PAD, top - 44);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = palette.ink;
    ctx.font = `italic 400 40px ${SANS}`;
    lines.forEach((line, index) => {
      ctx.fillText(line, PAD, top + 12 + index * 52);
    });
  }

  // ——— Whose record it is, which is all the card may claim of itself.
  ctx.fillStyle = palette.muted;
  ctx.font = `500 26px ${SANS}`;
  ctx.fillText(postcard.recordedBy, PAD, height - PAD);
}

/**
 * The face stack. No web font is loaded for the export — a font the browser has
 * not finished fetching draws as a fallback anyway, and the caller awaits
 * `document.fonts.ready` before it starts.
 */
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Greedy word wrap against the real measured width of the font being drawn in.
 * A word longer than the whole measure gets its own line and overhangs, which
 * is a visible failure a reader can report rather than a silent truncation of
 * something they typed themselves.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  font: string,
): string[] {
  ctx.font = font;
  const lines: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= maxWidth) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else {
      lines.push(word);
    }
  }
  return lines;
}
