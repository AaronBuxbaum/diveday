const MAX_SITE_IMAGES = 6;

/** Turn staff's one-link-per-line form input into a compact, safe site gallery. */
export function splitMediaUrls(value: string): string[] {
  const urls = [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((url) => url.trim())
        .filter(Boolean),
    ),
  ];
  if (urls.length > MAX_SITE_IMAGES) throw new Error("Choose up to six images.");
  for (const url of urls) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Each image must be a complete HTTP(S) link.");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Each image must be a complete HTTP(S) link.");
    }
  }
  return urls;
}
