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
 * 400 dpi at the 32mm the sheets draw it — past what a phone camera needs and
 * past what a laser blurs.
 */
const CODE_PIXELS = 512;

export async function SheetCode({
  value,
  label,
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
  className?: string;
}) {
  const dataUrl = await QRCode.toDataURL(value, { margin: 1, width: CODE_PIXELS });
  return (
    // biome-ignore lint/performance/noImgElement: a data: URL this server render just produced.
    <img src={dataUrl} alt={label} className={className} />
  );
}
