/** Private person photos are served only through a live authorization check. */
export const PRIVATE_PERSON_PHOTO_PREFIX = "private-person-photos";
const ASSET_ID = /^[A-Za-z0-9_-]{22}\.jpg$/;

export function privatePersonPhotoId(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.search || parsed.hash || parsed.username || parsed.password) return null;
    const match = parsed.pathname.match(/^\/private-person-photos\/([^/]+)$/);
    return match?.[1] && ASSET_ID.test(match[1]) ? match[1] : null;
  } catch {
    return null;
  }
}

export function personPhotoDisplayPath(
  personId: string,
  url: string | null | undefined,
): string | null {
  const id = privatePersonPhotoId(url);
  return id ? `/api/person-photos/${encodeURIComponent(personId)}/${id}` : null;
}

/** Suppression is scoped to diver surfaces; it does not alter staff portraits. */
export function diverPhotoDisplayPath(person: {
  id: string;
  diverPhotoPath?: string | null;
  diverPhotoSuppressed?: boolean;
  staffPhotoPath?: string | null;
}): string | null {
  if (person.diverPhotoSuppressed) return null;
  return personPhotoDisplayPath(person.id, person.diverPhotoPath) ?? person.staffPhotoPath ?? null;
}

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export function privatePersonPhotoNotFound() {
  return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
}

export function privatePersonPhotoResponse(object: { bytes: ArrayBuffer; contentType: string }) {
  if (object.contentType !== "image/jpeg") return privatePersonPhotoNotFound();
  return new Response(object.bytes, {
    headers: { ...NO_STORE, "Content-Type": "image/jpeg", "X-Robots-Tag": "noindex, nofollow" },
  });
}
