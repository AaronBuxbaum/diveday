import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const instant = true;

export const metadata: Metadata = { title: "Add diver — DiveDay" };

export default async function NewDiverPage({
  params,
  searchParams,
}: {
  params: Promise<{ shopSlug: string }>;
  searchParams: Promise<{
    q?: string;
    name?: string;
    email?: string;
    phone?: string;
  }>;
}) {
  const { shopSlug } = await params;
  const { q, name, email, phone } = await searchParams;
  const query = (name || email || phone || q || "").trim();
  redirect(
    query ? `/shop/${shopSlug}/divers?q=${encodeURIComponent(query)}` : `/shop/${shopSlug}/divers`,
  );
}
