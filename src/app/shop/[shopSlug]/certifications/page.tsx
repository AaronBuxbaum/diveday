import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireStaffSession } from "@/lib/session";

export const metadata: Metadata = { title: "Certifications — Scuba" };

/**
 * Cards belong to a diver's person record now. Keep this route as a safe
 * bookmark redirect for staff who used the former cards-first surface.
 */
export default async function CertificationsPage({
  params,
}: {
  params: Promise<{ shopSlug: string }>;
}) {
  await requireStaffSession();
  const { shopSlug } = await params;
  redirect(`/shop/${shopSlug}/divers`);
}
