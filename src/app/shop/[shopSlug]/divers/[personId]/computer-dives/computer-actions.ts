"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import {
  annotateComputerDive,
  commitComputerFiles,
  deleteComputerDive,
  exportComputerDives,
  previewComputerFiles,
  restoreComputerDive,
} from "@/features/computer-dives";
import { requireShopSurface } from "@/features/session";
import { uuidParam } from "@/lib/uuid";

async function context(shopSlug: string, personId: string) {
  if (!uuidParam(personId)) notFound();
  const { db, session } = await requireShopSurface(shopSlug);
  return {
    db,
    scope: { shopId: session.user.shopId, actorPersonId: session.user.personId, personId },
  };
}

async function readFiles(data: FormData) {
  const files = data.getAll("files");
  if (
    !files.length ||
    files.length > 5 ||
    files.some((file) => !(file instanceof File) || file.size > 2 * 1024 * 1024 || !file.size)
  )
    throw new Error("invalid_file");
  return Promise.all(
    (files as File[]).map(async (file) => ({
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
}

export async function previewAction(shopSlug: string, personId: string, data: FormData) {
  const { db, scope } = await context(shopSlug, personId);
  try {
    return {
      ok: true as const,
      value: await previewComputerFiles(db, scope, await readFiles(data)),
    };
  } catch {
    return { ok: false as const };
  }
}

export async function commitAction(shopSlug: string, personId: string, data: FormData) {
  const { db, scope } = await context(shopSlug, personId);
  try {
    const selectedKeys = data
      .getAll("selected")
      .filter((value): value is string => typeof value === "string");
    const requestKey = data.get("requestKey");
    const confirmedPersonId = data.get("confirmedPersonId");
    const offsets = data.get("timeOffsets");
    if (
      typeof requestKey !== "string" ||
      typeof confirmedPersonId !== "string" ||
      typeof offsets !== "string" ||
      offsets.length > 20000
    )
      throw new Error("invalid_selection");
    const timeOffsets: Record<string, number | null> = JSON.parse(offsets);
    const value = await commitComputerFiles(db, scope, {
      files: await readFiles(data),
      selectedKeys,
      requestKey,
      confirmedPersonId,
      timeOffsets,
    });
    revalidatePath(`/shop/${shopSlug}/divers/${personId}/computer-dives`);
    return { ok: true as const, value };
  } catch {
    return { ok: false as const };
  }
}

export async function changeAction(
  shopSlug: string,
  personId: string,
  id: string,
  intent: "note" | "delete" | "restore",
  note: string,
) {
  const { db, scope } = await context(shopSlug, personId);
  try {
    if (!uuidParam(id)) throw new Error("not_found");
    if (intent === "note") await annotateComputerDive(db, scope, id, note);
    else if (intent === "delete") await deleteComputerDive(db, scope, id);
    else if (intent === "restore") await restoreComputerDive(db, scope, id);
    else throw new Error("invalid_selection");
    revalidatePath(`/shop/${shopSlug}/divers/${personId}/computer-dives`);
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export async function exportAction(shopSlug: string, personId: string) {
  const { db, scope } = await context(shopSlug, personId);
  try {
    return { ok: true as const, value: await exportComputerDives(db, scope) };
  } catch {
    return { ok: false as const };
  }
}
