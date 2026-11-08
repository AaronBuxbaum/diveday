import type { loadShopExportBundleInput } from "./export";

export function table(
  input: NonNullable<Awaited<ReturnType<typeof loadShopExportBundleInput>>>,
  file: string,
) {
  const found = input.tables.find((candidate) => candidate.file === file);
  if (!found) throw new Error(`missing table ${file}`);
  return found;
}
