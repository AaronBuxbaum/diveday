/**
 * Resolve an English fallback from any message bundle without importing that
 * bundle here. Keeping the bundle as an argument lets narrow client bundles
 * such as the offline manifest reuse the lookup without pulling in all staff
 * messages.
 */
export function messageFallback(messages: unknown, key: string): string {
  const value = key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object" || !Object.hasOwn(node, part)) return undefined;
    return (node as Record<string, unknown>)[part];
  }, messages);

  return typeof value === "string" ? value : key;
}
