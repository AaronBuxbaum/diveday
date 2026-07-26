import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { getDb } from "@/db/client";
import { getShopById } from "@/db/shops";
import { escapeHtml } from "@/lib/html";
import { publicAppUrl } from "@/lib/notifications";
import { requireStaffSession } from "@/lib/session";
import { SnippetField } from "./SnippetField";

export const metadata: Metadata = { title: "Website embed — DiveDay" };

/**
 * Snippets a shop pastes into its own website — the piece FareHarbor's embed
 * generator covers and DiveDay didn't (docs ADR 20260726-schedule-embed).
 * Only the schedule/trip pages carry the framing exception src/proxy.ts grants
 * (`isEmbeddableShopRoute`), so every snippet here targets exactly those URLs.
 */
export default async function EmbedSettingsPage() {
  const session = await requireStaffSession();
  const db = await getDb();
  // Built from the staff member's own authorized shop, never the route's
  // shopSlug param — a stale or mismatched URL segment must never generate
  // a snippet that labels one shop's name on another shop's calendar.
  const shop = await getShopById(db, session.user.shopId);
  if (!shop) redirect("/");

  const origin = publicAppUrl();
  const scheduleUrl = origin ? `${origin}/shop/${shop.slug}/schedule` : null;

  if (!scheduleUrl) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        <ShopPageHeader eyebrow="Settings" title="Website embed" />
        <p className="rounded-lg bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
          Embed links need a configured public hosting address — ask whoever runs your DiveDay
          hosting to finish setup before these snippets can be generated.
        </p>
      </main>
    );
  }

  const embedUrl = `${scheduleUrl}?embed=1`;
  const shopNameAttr = escapeHtml(shop.name);
  const iframeSnippet = `<iframe src="${embedUrl}" title="${shopNameAttr} — book a dive" style="width:100%;max-width:720px;height:900px;border:0;border-radius:12px" loading="lazy"></iframe>`;
  // Deliberately the plain schedule URL, not the embed one: this is a link a
  // browser navigates to directly, never a frame, so it should land on the
  // full page — including for a shop that takes online payment, where a
  // hosted Stripe Checkout may refuse to render inside someone else's iframe.
  const buttonSnippet = `<a href="${scheduleUrl}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;font:600 15px/1 system-ui,sans-serif;text-decoration:none;border-radius:10px">Book a dive</a>`;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <ShopPageHeader
        eyebrow="Settings"
        title="Website embed"
        description="Paste one of these into your own website so divers can browse and book without leaving your site. Both point at the same live schedule — no separate setup, no sync to keep working."
      />

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">Calendar embed</h2>
        <p className="mt-1 text-sm text-muted">
          A full booking calendar, sized to fit wherever you place it on your page. Best for a
          dedicated "Book now" page on your site.
        </p>
        <div className="mt-4">
          <SnippetField label="Embed code" rows={3} snippet={iframeSnippet} />
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-border bg-surface p-6">
        <h2 className="font-medium">"Book a dive" button</h2>
        <p className="mt-1 text-sm text-muted">
          A plain link styled as a button, no iframe. Opens your DiveDay schedule in a new tab — the
          simplest option, and the one to use if you take online payment, since a checkout page may
          refuse to open inside another site's frame.
        </p>
        <div className="mt-4">
          <SnippetField label="Button code" rows={2} snippet={buttonSnippet} />
        </div>
      </section>

      <p className="mt-6 text-sm text-muted">
        Both snippets point at{" "}
        <a href={scheduleUrl} target="_blank" rel="noopener" className="text-primary underline">
          your public schedule
        </a>
        . Editing a trip, adding a departure, or changing your rental prices shows up the moment a
        diver loads the embed — nothing to republish.
      </p>
    </main>
  );
}
