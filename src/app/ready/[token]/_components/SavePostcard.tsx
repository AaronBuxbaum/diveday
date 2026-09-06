"use client";

import { type ReactNode, useId, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/form";
import {
  drawPostcard,
  POSTCARD_FRAME,
  type PostcardImage,
  type PostcardPalette,
} from "@/lib/postcard-image";

/**
 * **The line a diver writes for themselves, and the picture it goes on** —
 * D33 (issue #1193) and issue #1081, slice 16i of ADR
 * 20260904-reef-all-the-way-down.
 *
 * These are one component because they are one piece of state. The line is
 * typed here, held here in `useState`, and read here when the canvas is drawn:
 * **it has no path off the phone at all**, which is the promise the row's own
 * sentence makes and the only version of that promise worth making.
 *
 * That is structural, and it is three things at once:
 *
 * - the `<textarea>` has **no `name`**, so nothing about it can enter a
 *   `FormData`;
 * - it sits in no `<form>` and this component renders none, so there is no
 *   submit that could carry it;
 * - the value is never sent anywhere — the only thing that reads it is
 *   `drawPostcard`, in this tab, into a canvas.
 *
 * `SavePostcard.test.tsx` asserts all three, and `e2e/recap.spec.ts` sweeps
 * every request the page makes for a typed sentinel. Both, deliberately: the
 * unit assertions say the shape is right, and only the sweep says nothing else
 * on the page picked it up.
 *
 * **The export borrows the live drawing rather than redrawing it.** The site
 * mark on the record's face is serialised out of the DOM (`[data-postcard-mark]`),
 * so there is no second copy of the illustration hand to keep in step — and a
 * failure to borrow it degrades to a card with no drawing rather than no card
 * (`drawPostcard` takes a null mark).
 *
 * **The palette follows the viewer's theme**, read off the live document. A
 * decision rather than an oversight: this is the diver's own keepsake of the
 * page they were looking at, and a dark-mode diver saving a suddenly-light card
 * is the surface telling them their theme was a mistake. The argument the other
 * way — that a shared picture should read the same in everybody's group chat —
 * is real and is written down in this slice's plan as an open question for the
 * owner; changing it is one line here and no change at all in
 * `src/lib/postcard-image.ts`, which decides no colours.
 *
 * **Two ways off the page, and the phone gets the better one** (issue #1407).
 * Where the browser will take a file — `navigator.canShare({ files })`, the
 * feature test, never a user-agent sniff — the card goes straight into the
 * share sheet, which is where a diver sharing their day was heading anyway.
 * Everywhere else it falls back to the mechanism already shipping under this
 * app's CSP: `toDataURL` onto an `<a download>`
 * (`settings/embed/EmbedGenerator.tsx`). No html-to-image, no dom-to-image, no
 * new dependency, and the fallback is byte-for-byte what it always was — which
 * is what keeps the Chromium e2e download spec meaningful, since Chromium does
 * not take the share path.
 *
 * That fallback existed because iOS Safari has historically ignored the
 * `download` attribute: the data URL opens in a new tab and the diver long-presses
 * to save. A degradation rather than a failure, but the phone is the device
 * this feature is *for*, which is what the share path is about.
 *
 * Two things the share path has to get right, and both are load-bearing:
 *
 * - **The blob is built before `share` is called.** Some platforms require the
 *   share call to be reachable from the click gesture, and awaiting the canvas
 *   first is what breaks that. So the file is finished, *then* offered.
 * - **A dismissed sheet is not an error.** Cancelling rejects the promise with
 *   an `AbortError`, and treating that as a failure would show the "didn't
 *   save" alert to somebody who simply changed their mind. It is caught by
 *   name and returns the button to rest.
 *
 * Holds no copy: every string is a `copy` prop, like `PrintRecordButton`.
 */
export type SavePostcardCopy = {
  lineLabel: string;
  lineHint: string;
  linePlaceholder: string;
  save: string;
  saving: string;
  failed: string;
};

/** How long a line the card can carry before it stops being one line. */
export const MAX_POSTCARD_LINE_LENGTH = 140;

/**
 * Two device pixels per CSS pixel: the card is read at phone width and shared
 * into feeds that upscale, and 1x text on a 4:5 frame reads soft. The layout in
 * `drawPostcard` is in CSS pixels throughout, so this is the only place the
 * scale exists.
 */
const EXPORT_SCALE = 2;

export function SavePostcard({
  postcard,
  fileName,
  copy,
  recordedBy,
  children,
}: {
  /** The same worded facts `DiveRecord` renders, assembled server-side. */
  postcard: PostcardImage;
  /** The saved file's name, already free of anything identifying a token. */
  fileName: string;
  copy: SavePostcardCopy;
  /**
   * "Recorded by {shop}" — the record's own footer line, passed in rather than
   * spelled here, because this component owns the block those two rows are
   * *both* in. Splitting them across two call sites was tried and is what puts
   * a full-width textarea into a `justify-between` row.
   */
  recordedBy: ReactNode;
  /** What sits beside Save in the footer's action group — `PrintRecordButton`. */
  children: ReactNode;
}) {
  const lineId = useId();
  const hintId = useId();
  const [line, setLine] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");

  async function save() {
    setState("saving");
    try {
      // The face has to be settled before anything is measured, or the export
      // draws in whatever the browser had loaded when the click landed.
      await document.fonts?.ready;
      const canvas = document.createElement("canvas");
      canvas.width = POSTCARD_FRAME.width * EXPORT_SCALE;
      canvas.height = POSTCARD_FRAME.height * EXPORT_SCALE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.scale(EXPORT_SCALE, EXPORT_SCALE);
      drawPostcard(
        ctx,
        { ...postcard, privateLine: line.trim() ? line.trim() : null },
        readPalette(),
        await borrowSiteMark(),
      );
      if (await shareCard(canvas, fileName)) {
        setState("idle");
        return;
      }
      const href = canvas.toDataURL("image/png");
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = fileName;
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setState("idle");
    } catch {
      setState("failed");
    }
  }

  return (
    <>
      {/* The diver's own line, on the record and above its footer. `print:hidden`
          because the printed sheet is a logbook page a divemaster signs, and a
          sentence somebody wrote for themselves is not a fact of the day. */}
      <div className="mt-5 border-t border-dashed border-border pt-4 print:hidden">
        <label htmlFor={lineId} className="text-xs font-medium text-muted">
          {copy.lineLabel}
        </label>
        <textarea
          id={lineId}
          // **No `name`, and no `<form>` above it.** See this file's doc comment:
          // that pair is the whole of D33's promise.
          rows={2}
          maxLength={MAX_POSTCARD_LINE_LENGTH}
          value={line}
          onChange={(event) => setLine(event.target.value)}
          placeholder={copy.linePlaceholder}
          aria-describedby={hintId}
          className={`${controlClass} mt-1.5`}
        />
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {copy.lineHint}
        </p>
      </div>
      {/* The record's own footer: whose record it is on the left, what a diver
          can do with it on the right. */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        {recordedBy}
        <span className="flex flex-wrap items-center gap-2 print:hidden">
          {state === "failed" ? (
            <span role="alert" className="text-xs text-danger">
              {copy.failed}
            </span>
          ) : null}
          <button
            type="button"
            onClick={save}
            disabled={state === "saving"}
            aria-busy={state === "saving"}
            className={buttonClass({ variant: "secondary", size: "sm", busy: true })}
          >
            {state === "saving" ? copy.saving : copy.save}
          </button>
          {children}
        </span>
      </div>
    </>
  );
}

/**
 * Hand the finished card to the platform's share sheet, or say the sheet is not
 * an option — `true` means the diver has been dealt with and the caller must
 * not also click an anchor at them.
 *
 * A **dismissal returns `true`**: the diver saw the sheet and closed it, which
 * is a completed interaction, and following it with a download would be the
 * page overriding the choice they just made. Only a browser that cannot take
 * the file at all returns `false`, and only a genuine share failure throws —
 * which the caller reports, because at that point nothing reached the diver.
 */
async function shareCard(canvas: HTMLCanvasElement, fileName: string): Promise<boolean> {
  // Cheap first: no share API at all means no blob worth encoding.
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") {
    return false;
  }
  const blob = await canvasBlob(canvas);
  if (!blob) return false;
  const file = new File([blob], fileName, { type: "image/png" });
  // The files test specifically. A browser can have `share` for links and still
  // refuse a file, and `canShare()` with no argument would answer for the wrong
  // question.
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file] });
  } catch (error) {
    // `AbortError` is the cancel button. Anything else genuinely failed.
    if ((error as DOMException | null)?.name !== "AbortError") throw error;
  }
  return true;
}

/** `canvas.toBlob` as a promise, resolving to null on a canvas that cannot encode. */
function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  if (typeof canvas.toBlob !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

/**
 * The six colours the card is drawn in, resolved off the live document — never
 * a hex here and never a palette-scale class (ADR-0004). A token the page has
 * not defined resolves to an empty string, which canvas ignores; the ground is
 * painted first, so the worst case is a flat card rather than a transparent one.
 */
function readPalette(): PostcardPalette {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    surface: token("--surface"),
    band: token("--primary-tint"),
    ink: token("--foreground"),
    muted: token("--muted"),
    accent: token("--primary"),
    rule: token("--border"),
  };
}

/**
 * The record's own site drawing, lifted out of the page and decoded as an
 * image — or null on any failure at all, which the caller draws around.
 *
 * `SiteMark`'s SVG is drawn in `currentColor` and two custom properties, none
 * of which survive being detached from the document, so the clone is given
 * resolved values inline before it is serialised. Anything unexpected here is
 * caught and becomes a card without a drawing: the mark is decoration beside
 * facts that say everything, and losing it must never lose the keepsake.
 */
async function borrowSiteMark(): Promise<CanvasImageSource | null> {
  try {
    const host = document.querySelector("[data-postcard-mark]");
    const svg = host?.querySelector("svg");
    if (!host || !svg) return null;
    const hostStyle = getComputedStyle(host);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", "240");
    clone.setAttribute("height", "168");
    clone.style.color = hostStyle.color;
    clone.style.setProperty(
      "--site-mark-fill",
      hostStyle.getPropertyValue("--site-mark-fill").trim(),
    );
    clone.style.setProperty(
      "--accent",
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    );
    const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
    const image = new Image();
    image.src = source;
    await image.decode();
    return image;
  } catch {
    return null;
  }
}
