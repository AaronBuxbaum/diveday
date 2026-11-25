"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { signOutDiver } from "@/features/accounts/diver-sign-in";
import { publicSchedulePath } from "@/lib/public-routes";

/**
 * Sign out of one shop's pages and land on its schedule (ADR
 * 20261125-diver-sign-in). Shared by My profile and the booking form's "Not
 * you?" line.
 */
export async function signOutDiverAction(shopSlug: string) {
  await signOutDiver(await getDb(), shopSlug);
  redirect(publicSchedulePath(shopSlug));
}
