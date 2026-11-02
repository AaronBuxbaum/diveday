/**
 * Whether a client-side crash is the page being older than the server.
 *
 * Production deploys every few minutes, and every deploy renumbers the Server
 * Actions and the script chunks. A tab left open across one still holds the old
 * ids: its next button press reaches the new server as an action it has never
 * heard of (`UnrecognizedActionError`), or asks for a chunk that is gone
 * (`ChunkLoadError`). Retrying in place can never work, because the stale
 * script is what is asking. Only loading the page again does.
 */
export function isStaleDeployError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "UnrecognizedActionError" ||
    error.name === "ChunkLoadError" ||
    /Failed to find Server Action|Server Action ".*" was not found|Loading chunk [\w-]+ failed/.test(
      error.message,
    )
  );
}
