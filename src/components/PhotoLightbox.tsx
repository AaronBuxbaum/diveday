"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { StoredPhoto } from "@/components/StoredPhoto";

export type LightboxPhoto = { src: string; alt: string };

export type LightboxWords = {
  /** Names the open dialog, for a screen reader. */
  label: string;
  close: string;
  previous: string;
  next: string;
};

/**
 * **A photo that opens large when tapped**, with next and previous when there is more than one.
 *
 * The thumbnails are real buttons; the large view is a native modal `<dialog>`, so focus is held
 * inside it, Escape closes it and focus returns to the photo that opened it. Left and right
 * arrows step through the set. Nothing moves by itself and nothing animates beyond the browser's
 * own dialog paint, so `prefers-reduced-motion` has nothing to still. Words come in as props:
 * this is a Client Component, and the page that owns the copy owns the bundle.
 */
export function PhotoLightbox({
  photos,
  words,
  sizes,
  thumbClassName,
  renderThumb,
}: {
  photos: readonly LightboxPhoto[];
  words: LightboxWords;
  sizes: string;
  /** Sizes the box around each thumbnail (aspect, width, rounding). */
  thumbClassName: string;
  /** Wraps the thumbnails: a list for a strip, a bare fragment for one photo. */
  renderThumb: (thumb: React.ReactNode, index: number) => React.ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open === null) {
      if (el.open) el.close();
      return;
    }
    if (!el.open) el.showModal();
  }, [open]);

  const step = (by: number) =>
    setOpen((at) => (at === null ? at : (at + by + photos.length) % photos.length));
  const photo = open === null ? null : photos[open];
  const many = photos.length > 1;

  const thumbButton = (p: LightboxPhoto, index: number) => (
    <button
      type="button"
      onClick={(e) => {
        opener.current = e.currentTarget;
        setOpen(index);
      }}
      aria-haspopup="dialog"
      aria-label={p.alt || words.label}
      className="block w-full cursor-zoom-in rounded-inset focus-visible:focus-ring"
    >
      <StoredPhoto src={p.src} alt="" className={thumbClassName} sizes={sizes} />
    </button>
  );

  return (
    <>
      {photos.map((p, index) => renderThumb(thumbButton(p, index), index))}
      <dialog
        ref={dialog}
        aria-label={words.label}
        onClose={() => {
          setOpen(null);
          opener.current?.focus();
        }}
        onClick={(e) => {
          if (e.target === dialog.current) setOpen(null);
        }}
        onKeyDown={(e) => {
          if (!many) return;
          if (e.key === "ArrowRight") step(1);
          if (e.key === "ArrowLeft") step(-1);
        }}
        className="m-auto max-h-[92dvh] w-[min(96vw,64rem)] overflow-hidden rounded-lg bg-surface p-0 text-fg backdrop:bg-black/70"
      >
        {photo ? (
          <div className="relative">
            <div className="relative aspect-[4/3] max-h-[80dvh] w-full bg-surface-sunken">
              <Image
                src={photo.src}
                alt={photo.alt}
                fill
                sizes="(min-width: 1024px) 64rem, 96vw"
                className="object-contain"
              />
            </div>
            <div className="flex items-center justify-between gap-3 p-3">
              {many ? (
                <button type="button" onClick={() => step(-1)} className="min-h-11 px-4 text-sm">
                  {words.previous}
                </button>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => setOpen(null)}
                className="min-h-11 px-4 text-sm font-medium"
              >
                {words.close}
              </button>
              {many ? (
                <button type="button" onClick={() => step(1)} className="min-h-11 px-4 text-sm">
                  {words.next}
                </button>
              ) : (
                <span />
              )}
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
