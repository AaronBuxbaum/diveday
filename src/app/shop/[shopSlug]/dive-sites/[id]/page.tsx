import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ShopPageHeader } from "@/components/ShopPageHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/components/ui/button";
import { controlClass, Field, FieldGrid } from "@/components/ui/form";
import { getDb } from "@/db/client";
import {
  copyDiveSite,
  deleteDiveSite,
  getDiveSite,
  listDiveSites,
  updateDiveSite,
} from "@/db/dive-sites";
import { splitMediaUrls } from "@/lib/dive-sites";
import { revalidateAndRedirect } from "@/lib/navigation";
import { CERTIFICATION_LEVEL_LABELS, SPECIALTY_LABELS } from "@/lib/readiness";
import { requireStaffSession } from "@/lib/session";
import { ingestDiveSiteMedia } from "@/lib/storage/ingest-dive-site-media";

export const metadata: Metadata = { title: "Edit dive site — DiveDay" };

const optionalUrl = z.union([z.literal(""), z.url().max(2_000)]);
const specialtySchema = z.enum(["deep", "wreck", "night", "drysuit"]);
const siteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1_200),
    locationName: z.string().trim().max(160),
    forecastLatitude: z.union([z.literal(""), z.coerce.number().min(-90).max(90)]),
    forecastLongitude: z.union([z.literal(""), z.coerce.number().min(-180).max(180)]),
    satelliteImageUrl: optionalUrl,
    routeImageUrl: optionalUrl,
    imageUrls: z.string().max(12_000),
    marineLife: z.string().trim().max(400),
    marineLifeDescription: z.string().trim().max(1_200),
    difficulty: z.string().trim().max(120),
    depthRange: z.string().trim().max(120),
    currentNote: z.string().trim().max(500),
    divePlan: z.string().trim().max(1_200),
    landmarks: z.string().max(4_000),
    minimumCertificationLevel: z.preprocess(
      (value) => (value === "" ? null : value),
      z
        .enum(["open_water", "advanced_open_water", "rescue", "divemaster", "instructor"])
        .nullable(),
    ),
  })
  .refine(
    (site) => (site.forecastLatitude === "") === (site.forecastLongitude === ""),
    "Add both forecast coordinates or leave both blank.",
  );

export default async function EditDiveSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string; id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const session = await requireStaffSession();
  const { shopSlug, id } = await params;
  const { notice, error } = await searchParams;
  const back = `/shop/${shopSlug}/dive-sites`;
  const db = await getDb();
  const site = await getDiveSite(db, session.user.shopId, id);
  if (!site) notFound();

  async function saveAction(formData: FormData) {
    "use server";
    const activeSession = await requireStaffSession();
    const parsed = siteSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) redirect(`${back}/${id}?error=invalid`);
    const specialties = z
      .array(specialtySchema)
      .safeParse(formData.getAll("specialty").map(String));
    if (!specialties.success) redirect(`${back}/${id}?error=invalid`);
    let imageUrls: string[];
    try {
      imageUrls = splitMediaUrls(parsed.data.imageUrls);
    } catch {
      redirect(`${back}/${id}?error=images`);
    }
    const landmarks = parsed.data.landmarks
      .split("\n")
      .map((landmark) => landmark.trim())
      .filter(Boolean);
    // Every media URL becomes first-party before it's ever stored — a public
    // dive-site page must never make a live request to a staff-pasted
    // third-party host (CR-020).
    const media = await ingestDiveSiteMedia({
      satelliteImageUrl: parsed.data.satelliteImageUrl || undefined,
      routeImageUrl: parsed.data.routeImageUrl || undefined,
      imageUrls,
    });
    if (!media.ok) {
      redirect(
        `${back}/${id}?error=${media.reason === "not_configured" ? "images-unconfigured" : "images"}`,
      );
    }
    const updated = await updateDiveSite(await getDb(), activeSession.user.shopId, id, {
      shopId: activeSession.user.shopId,
      ...parsed.data,
      forecastLatitude: parsed.data.forecastLatitude === "" ? null : parsed.data.forecastLatitude,
      forecastLongitude:
        parsed.data.forecastLongitude === "" ? null : parsed.data.forecastLongitude,
      satelliteImageUrl: media.satelliteImageUrl,
      routeImageUrl: media.routeImageUrl,
      imageUrls: media.imageUrls,
      minimumCertificationLevel: parsed.data.minimumCertificationLevel,
      requiredSpecialties: specialties.data,
      requiresNitrox: formData.get("requiresNitrox") === "on",
      difficulty: parsed.data.difficulty,
      depthRange: parsed.data.depthRange,
      currentNote: parsed.data.currentNote,
      divePlan: parsed.data.divePlan,
      landmarks,
    });
    if (!updated) notFound();
    revalidateAndRedirect(`${back}/${id}`, `${back}/${id}?notice=saved`);
  }

  async function copyAction() {
    "use server";
    const activeSession = await requireStaffSession();
    const activeDb = await getDb();
    const names = new Set(
      (await listDiveSites(activeDb, activeSession.user.shopId)).map((entry) => entry.name),
    );
    let copyName = `${site.name} copy`;
    let number = 2;
    while (names.has(copyName)) copyName = `${site.name} copy ${number++}`;
    const copy = await copyDiveSite(activeDb, activeSession.user.shopId, id, copyName);
    if (!copy) notFound();
    revalidateAndRedirect(back, `${back}/${copy.id}?notice=copied`);
  }

  async function deleteAction() {
    "use server";
    const activeSession = await requireStaffSession();
    const deleted = await deleteDiveSite(await getDb(), activeSession.user.shopId, id);
    revalidateAndRedirect(
      back,
      deleted ? `${back}?notice=archived` : `${back}/${id}?error=invalid`,
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
      <Link href={back} className="text-sm font-medium text-primary hover:underline">
        ← Dive-site library
      </Link>
      <div className="mt-4">
        <ShopPageHeader
          eyebrow="Catalog"
          title={site.name}
          description="Changes update the briefing linked to this site."
          actions={
            <>
              <form action={copyAction}>
                <SubmitButton
                  pendingLabel="Copying…"
                  className={buttonClass({ variant: "secondary", className: "text-foreground" })}
                >
                  Copy and tailor
                </SubmitButton>
              </form>
              <details className="w-full sm:w-auto">
                <summary className="flex min-h-11 cursor-pointer items-center rounded-lg border border-danger/30 px-4 py-2 text-center text-sm font-medium text-danger">
                  Archive site
                </summary>
                <form
                  action={deleteAction}
                  className="mt-2 rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm sm:w-72"
                >
                  <p className="text-muted">
                    Historical trips keep their briefing; new trips will no longer see this site.
                  </p>
                  <SubmitButton
                    pendingLabel="Archiving…"
                    className={buttonClass({ variant: "danger-solid", className: "mt-3" })}
                  >
                    Archive briefing
                  </SubmitButton>
                </form>
              </details>
            </>
          }
        />
      </div>
      {notice ? (
        <p
          role="status"
          className="mt-6 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-success"
        >
          {notice === "copied" ? "Independent copy ready to tailor." : "Site briefing saved."}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-6 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {error === "images"
            ? "One of those image links couldn’t be used — use up to six complete HTTP(S) links, one per line, to a real, reachable image."
            : error === "images-unconfigured"
              ? "Image hosting isn’t set up for this shop yet — leave the image links blank for now, or ask your admin to configure it."
              : "That didn’t save. Check the name and links, then try again."}
        </p>
      ) : null}
      <form action={saveAction} className="mt-8 flex flex-col gap-5">
        <FieldGrid columns={1}>
          <Field label="Name">
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={site.name}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <fieldset className="rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Automated marine forecast point</legend>
          <p className="mt-1 text-sm text-muted">
            Use the offshore dive point, not the shop address. Leave both blank to keep crew-only
            conditions.
          </p>
          <FieldGrid columns={2} className="mt-4 gap-y-5">
            <Field label="Latitude">
              <input
                name="forecastLatitude"
                type="number"
                step="any"
                min={-90}
                max={90}
                defaultValue={site.forecastLatitude ?? ""}
                className={controlClass}
              />
            </Field>
            <Field label="Longitude">
              <input
                name="forecastLongitude"
                type="number"
                step="any"
                min={-180}
                max={180}
                defaultValue={site.forecastLongitude ?? ""}
                className={controlClass}
              />
            </Field>
          </FieldGrid>
        </fieldset>
        <FieldGrid columns={1} className="gap-y-5">
          <Field label="Location" hint="(optional)">
            <input
              name="locationName"
              maxLength={160}
              defaultValue={site.locationName ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label="What makes this site special?">
            <textarea
              name="description"
              rows={3}
              maxLength={1200}
              defaultValue={site.description ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={2} className="gap-y-5">
          <Field label="Satellite map image URL">
            <textarea
              name="satelliteImageUrl"
              rows={2}
              defaultValue={site.satelliteImageUrl ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label="Route image URL" hint="(optional)">
            <textarea
              name="routeImageUrl"
              rows={2}
              defaultValue={site.routeImageUrl ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={1} className="gap-y-5">
          <Field label="Site photo URLs" hint="(one per line, up to six)">
            <textarea
              name="imageUrls"
              rows={4}
              defaultValue={site.imageUrls.join("\n")}
              className={controlClass}
            />
          </Field>
          <Field label="What might divers see?">
            <input
              name="marineLife"
              maxLength={400}
              defaultValue={site.marineLife ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label="Underwater briefing">
            <textarea
              name="marineLifeDescription"
              rows={3}
              maxLength={1200}
              defaultValue={site.marineLifeDescription ?? ""}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={2} className="gap-y-5">
          <Field label="Difficulty" hint="(optional)">
            <input
              name="difficulty"
              maxLength={120}
              defaultValue={site.difficulty ?? ""}
              placeholder="Calm, intermediate, advanced"
              className={controlClass}
            />
          </Field>
          <Field label="Depth range" hint="(optional)">
            <input
              name="depthRange"
              maxLength={120}
              defaultValue={site.depthRange ?? ""}
              placeholder="20–45 ft"
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <FieldGrid columns={1} className="gap-y-5">
          <Field label="Current and conditions notes" hint="(optional)">
            <textarea
              name="currentNote"
              rows={2}
              maxLength={500}
              defaultValue={site.currentNote ?? ""}
              className={controlClass}
            />
          </Field>
          <Field label="Dive plan" hint="(optional)">
            <textarea
              name="divePlan"
              rows={3}
              maxLength={1200}
              defaultValue={site.divePlan ?? ""}
              placeholder="Entry, route, turnaround, and exit notes."
              className={controlClass}
            />
          </Field>
          <Field label="Landmarks" hint="(one per line, optional)">
            <textarea
              name="landmarks"
              rows={3}
              maxLength={4000}
              defaultValue={site.landmarks.join("\n")}
              className={controlClass}
            />
          </Field>
        </FieldGrid>
        <fieldset className="rounded-lg border border-border bg-surface-sunken p-5">
          <legend className="px-1 text-sm font-medium">Certification requirements</legend>
          <p className="text-sm text-muted">
            What this site itself demands. Every trip that visits enforces at least this — when the
            trip asks for more, the stricter rule wins.
          </p>
          <FieldGrid columns={1} className="mt-4">
            <Field label="Minimum certification">
              <select
                name="minimumCertificationLevel"
                defaultValue={site.minimumCertificationLevel ?? ""}
                className={controlClass}
              >
                <option value="">No level required by the site</option>
                {Object.entries(CERTIFICATION_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </FieldGrid>
          <div className="mt-4">
            <p className="text-sm font-medium">Required specialties</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(SPECIALTY_LABELS).map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <input
                    name="specialty"
                    type="checkbox"
                    value={value}
                    defaultChecked={site.requiredSpecialties.includes(
                      value as keyof typeof SPECIALTY_LABELS,
                    )}
                    className="size-4 accent-primary"
                  />
                  {label}
                </label>
              ))}
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  name="requiresNitrox"
                  type="checkbox"
                  defaultChecked={site.requiresNitrox}
                  className="size-4 accent-primary"
                />
                Nitrox
              </label>
            </div>
          </div>
        </fieldset>
        <SubmitButton
          pendingLabel="Saving…"
          className={buttonClass({ size: "lg", className: "mt-2 self-start text-base" })}
        >
          Save briefing
        </SubmitButton>
      </form>
    </main>
  );
}
