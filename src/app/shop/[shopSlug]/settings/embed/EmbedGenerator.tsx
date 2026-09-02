"use client";

import { useEffect, useId, useState } from "react";
import { buttonClass } from "@/components/ui/button";
import { SectionCard } from "@/components/ui/card";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import {
  DEFAULT_EMBED_OPTIONS,
  EMBED_KINDS,
  type EmbedKind,
  type EmbedLook,
  embedFrameUrl,
  embedSnippet,
  embedTargetUrl,
  partnerLinkUrl,
} from "@/lib/embed-snippets";
import { SnippetField } from "./SnippetField";

export type EmbedGeneratorCopy = {
  what: string;
  kinds: Record<EmbedKind, string>;
  kindHints: Record<EmbedKind, string>;
  shows: string;
  showEverything: string;
  showDeparture: string;
  look: string;
  lookSite: string;
  lookLight: string;
  lookNote: string;
  language: string;
  languageAuto: string;
  languages: Record<string, string>;
  preview: string;
  previewNote: string;
  platform: string;
  platforms: Record<Platform, string>;
  platformNotes: Record<Platform, string>;
  snippet: string;
  code: string;
  buttonText: string;
  partnerName: string;
  partnerPlaceholder: string;
  partnerLink: string;
  partnerLinkField: string;
  qrAlt: string;
  qrDownload: string;
  copy: string;
  copied: string;
  copyFailed: string;
};

export const PLATFORMS = ["html", "wordpress", "squarespace", "wix"] as const;
export type Platform = (typeof PLATFORMS)[number];

const FRAMED = new Set<EmbedKind>(["calendar", "grid", "departure", "courses"]);

/**
 * **The embed generator** (Harbor — ADR 20260901-diveday-reimagined, decision
 * 2): the one place a shop chooses what goes on its own website. Four choices
 * — what to embed, what it shows, how it looks, which language — compose one
 * snippet through `src/lib/embed-snippets.ts`, the same grammar
 * `public/embed.js` reads, so the preview on the right *is* the widget the
 * shop will get: a real frame of the real page. The QR code is drawn here in
 * the browser from the same target URL, so nothing is stored for it.
 *
 * Words arrive as props: this is a staff Client Component.
 */
export function EmbedGenerator({
  origin,
  shopSlug,
  trips,
  locales,
  copy,
}: {
  origin: string;
  shopSlug: string;
  trips: readonly { id: string; label: string }[];
  locales: readonly string[];
  copy: EmbedGeneratorCopy;
}) {
  const [kind, setKind] = useState<EmbedKind>("calendar");
  const [show, setShow] = useState<string>("");
  const [look, setLook] = useState<EmbedLook>("site");
  const [lang, setLang] = useState<string>("auto");
  const [platform, setPlatform] = useState<Platform>("html");
  const [partner, setPartner] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const ids = { kind: useId(), look: useId(), platform: useId() };

  const options = { look, lang, show: show || null };
  const needsShow = kind === "departure" || kind === "lightbox" || kind === "button";
  const target = embedTargetUrl(origin, shopSlug, options);
  const snippet =
    kind === "qr" || kind === "partner"
      ? null
      : embedSnippet(origin, shopSlug, kind, options, { button: copy.buttonText });
  const partnerUrl = partnerLinkUrl(origin, shopSlug, partner || "partner");

  useEffect(() => {
    if (kind !== "qr") return;
    let cancelled = false;
    import("qrcode").then(async (QRCode) => {
      const url = await QRCode.toDataURL(target, { margin: 1, width: 240 });
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, target]);

  const tile = (active: boolean) =>
    `flex min-h-11 flex-col items-start justify-center rounded-lg border px-3 py-2 text-start text-sm transition-colors ${
      active
        ? "border-primary bg-primary-tint text-foreground"
        : "border-border bg-surface text-foreground hover:bg-surface-sunken"
    }`;

  return (
    <div className="space-y-10">
      <SectionCard padding="lg" title={copy.what}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div className="space-y-5">
            <fieldset>
              <legend id={ids.kind} className="sr-only">
                {copy.what}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {EMBED_KINDS.map((k) => (
                  <label
                    key={k}
                    className={`${tile(kind === k)} cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary`}
                  >
                    <input
                      type="radio"
                      name={`${ids.kind}-kind`}
                      value={k}
                      checked={kind === k}
                      onChange={() => setKind(k)}
                      className="sr-only"
                    />
                    <span className="font-semibold">{copy.kinds[k]}</span>
                    <span className="text-xs text-muted">{copy.kindHints[k]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {needsShow ? (
              <Field label={copy.shows}>
                <select
                  value={show}
                  onChange={(event) => setShow(event.target.value)}
                  className={controlClass}
                >
                  <option value="">{copy.showEverything}</option>
                  {trips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}

            {kind === "partner" ? (
              <Field label={copy.partnerName}>
                <input
                  type="text"
                  value={partner}
                  onChange={(event) => setPartner(event.target.value)}
                  placeholder={copy.partnerPlaceholder}
                  maxLength={60}
                  className={controlClass}
                />
              </Field>
            ) : null}

            {kind !== "qr" && kind !== "partner" ? (
              <FieldGrid columns={2}>
                <Field label={copy.look} hint={look === "site" ? copy.lookNote : undefined}>
                  <div className="flex gap-1 rounded-inset border border-border bg-surface-sunken p-1">
                    {(["site", "light"] as const).map((value) => (
                      <label
                        key={value}
                        className={`flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-lg px-3 text-sm font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                          look === value ? "bg-surface text-foreground shadow-sm" : "text-muted"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`${ids.look}-look`}
                          value={value}
                          checked={look === value}
                          onChange={() => setLook(value)}
                          className="sr-only"
                        />
                        {value === "site" ? copy.lookSite : copy.lookLight}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label={copy.language}>
                  <select
                    value={lang}
                    onChange={(event) => setLang(event.target.value)}
                    className={controlClass}
                  >
                    <option value="auto">{copy.languageAuto}</option>
                    {locales.map((locale) => (
                      <option key={locale} value={locale}>
                        {copy.languages[locale] ?? locale}
                      </option>
                    ))}
                  </select>
                </Field>
              </FieldGrid>
            ) : null}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">{copy.preview}</p>
            <div className="rounded-panel border border-border bg-surface-sunken p-3">
              {FRAMED.has(kind) ? (
                <iframe
                  key={`${kind}-${show}-${lang}`}
                  title={copy.preview}
                  src={embedFrameUrl(
                    origin,
                    shopSlug,
                    kind as "calendar" | "grid" | "departure" | "courses",
                    { ...DEFAULT_EMBED_OPTIONS, lang, show: show || null, look: "light" },
                  )}
                  className="h-[480px] w-full rounded-lg border-0 bg-surface"
                />
              ) : kind === "qr" ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  {qr ? (
                    <>
                      {/* biome-ignore lint/performance/noImgElement: a data URL drawn in the browser */}
                      <img src={qr} alt={copy.qrAlt} width={240} height={240} />
                      <a
                        href={qr}
                        download={`diveday-${shopSlug}.png`}
                        className={buttonClass({ variant: "secondary" })}
                      >
                        {copy.qrDownload}
                      </a>
                    </>
                  ) : null}
                  <p className="break-all text-center text-xs text-muted">{target}</p>
                </div>
              ) : kind === "partner" ? (
                <p className="break-all py-4 text-sm">{partnerUrl}</p>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <a href={target} target="_blank" rel="noopener" className={buttonClass()}>
                    {copy.buttonText}
                  </a>
                </div>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">{copy.previewNote}</p>
          </div>
        </div>
      </SectionCard>

      {kind === "partner" ? (
        <SectionCard padding="lg" title={copy.partnerLink}>
          <SnippetField
            label={copy.partnerLinkField}
            rows={2}
            snippet={partnerUrl}
            copyLabel={copy.copy}
            copiedLabel={copy.copied}
            failedLabel={copy.copyFailed}
          />
        </SectionCard>
      ) : kind === "qr" ? null : (
        <SectionCard padding="lg" title={copy.snippet}>
          <div className="mb-4 flex flex-wrap gap-1">
            {PLATFORMS.map((p) => (
              <label
                key={p}
                className={`min-h-9 cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary ${
                  platform === p ? "border-primary bg-primary-tint" : "border-border bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name={`${ids.platform}-platform`}
                  value={p}
                  checked={platform === p}
                  onChange={() => setPlatform(p)}
                  className="sr-only"
                />
                {copy.platforms[p]}
              </label>
            ))}
          </div>
          <p className="mb-4 text-sm text-muted">{copy.platformNotes[platform]}</p>
          <SnippetField
            label={copy.code}
            rows={3}
            snippet={snippet ?? ""}
            copyLabel={copy.copy}
            copiedLabel={copy.copied}
            failedLabel={copy.copyFailed}
          />
        </SectionCard>
      )}
    </div>
  );
}
