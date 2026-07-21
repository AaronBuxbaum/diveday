import { ensureTestDbTemplate } from "./db-template";

/** Build the shared PGlite template snapshot before any worker starts. */
export default async function globalSetup(): Promise<void> {
  await ensureTestDbTemplate();
}
