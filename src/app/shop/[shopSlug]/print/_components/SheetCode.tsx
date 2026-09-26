import QRCode from "qrcode";

/**
 * **The code on a sheet.**
 *
 * Drawn the way `settings/CounterQrCard.tsx` draws one — the same `qrcode`
 * encoder, at the same default black-on-white — with one difference that
 * matters on paper: it is encoded on the **server**, into the document. The
 * counter's card can afford a client-side effect because a staffer is looking
 * at a screen; a sheet is opened and immediately handed to the print dialog by
 * `AutoPrint`, and a code that arrived one paint later would be a white square
 * on the sign at the slip.
 *
 * Rendered at 512 device pixels whatever its printed size, which is about
 * 300 dpi across the dock sign's 32mm symbol and its quiet zone — past what a
 * phone camera needs and past what a laser blurs.
 *
 * **The quiet zone is the code's own, and it overhangs the code's box.** The
 * QR spec owes a scanner four modules of white on every side, so the image
 * carries them (`margin: 4`) rather than trusting whatever is around it — at
 * the dock sign's left edge the body's padding is 4.3mm, short of the 5.1mm
 * four modules of a 32mm version-2 code need, and the rest was the printer's
 * margin. But a quiet zone inside the
 * box stands the ink that far inside the text column the box sits in: with one
 * module the pixel probe measured the pass's code 3px right of its title and
 * the dock sign's 2px and 4px right of their captions. So the caller names the
 * *symbol's* size in millimetres, and the box is drawn at that size with the
 * quiet zone outdented on every side: the ink sits on the column, and the
 * white travels with it. The module count comes from the encoder, so the
 * outdent is exact for whatever version the payload makes.
 *
 * The words beside a code keep four modules clear of its box, or the quiet
 * zone is painted over them, sized for the coarsest code its payload can make:
 * a booking id is always a version 3 (29 modules), so 3.3mm around the pass's
 * 24mm code; a storefront link on a short slug is a version 2 (25 modules), so
 * 5.1mm around the dock sign's 32mm codes and 5.4mm around the sticker's 34mm
 * one. `SheetCode.test.tsx` checks all three, and reads the rendered PNG for
 * its white edge.
 */
const CODE_PIXELS = 512;

/** The QR spec's quiet zone: four modules of white on every side. */
export const QUIET_ZONE_MODULES = 4;

/** What every sheet's code is encoded with; the test renders the same. */
export const SHEET_CODE_OPTIONS = { margin: QUIET_ZONE_MODULES, width: CODE_PIXELS } as const;

/** A length in millimetres, to two places. */
const mm = (value: number) => `${Math.round(value * 100) / 100}mm`;

export async function SheetCode({
  value,
  label,
  size,
  className = "",
}: {
  /**
   * What the code carries. Every caller passes a value it can defend: the two
   * on the dock sign are public URLs, and the pass's is the booking's id and
   * nothing else (`passCodePayload`).
   */
  value: string;
  /** What this code opens, for a reader who cannot photograph it. */
  label: string;
  /** The symbol's printed width in millimetres, its quiet zone not counted. */
  size: number;
  className?: string;
}) {
  const quiet = (QUIET_ZONE_MODULES * size) / QRCode.create(value).modules.size;
  const dataUrl = await QRCode.toDataURL(value, SHEET_CODE_OPTIONS);
  return (
    // biome-ignore lint/performance/noImgElement: a data: URL this server render just produced.
    <img
      src={dataUrl}
      alt={label}
      // `max-w-none`: preflight's `max-width: 100%` would shrink the
      // overhanging box in a narrow column, and the symbol with it.
      className={`max-w-none ${className}`.trim()}
      style={{ width: mm(size + 2 * quiet), margin: `-${mm(quiet)}` }}
    />
  );
}
