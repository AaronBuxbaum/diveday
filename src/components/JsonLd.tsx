import { type JsonLdObject, pruneJsonLd } from "@/lib/structured-data";

/**
 * One `application/ld+json` block. The single place in the app that writes a
 * structured-data script tag, so the escaping rule lives in one reviewed spot
 * rather than being re-derived per page.
 *
 * Safety: the graph is serialized with `JSON.stringify` (never interpolated),
 * so a value carrying quotes or markup is escaped as JSON string content and
 * cannot break out of the surrounding element. Escaping `<` on top of that
 * closes the one remaining hole — a literal `</script>` inside a string, which
 * the HTML parser would otherwise honor before the JSON parser ever saw it.
 */
export function JsonLd({ data }: { data: JsonLdObject }) {
  const pruned = pruneJsonLd(data);
  if (!pruned) return null;
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD is JSON.stringify'd (not interpolated) and `<`-escaped, so no value can close the script element.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(pruned).replace(/</g, "\\u003c") }}
    />
  );
}
