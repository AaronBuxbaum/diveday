/** demo-preview public contract. Internals are imported only within this module. */
export {
  PREVIEW_MAX_BOATS,
  PREVIEW_MAX_DEPARTURES,
  PREVIEW_TTL_MS,
  type PreviewInput,
  parseDepartureTimes,
  parsePreviewInput,
  previewIdFrom,
  previewIsOpen,
  previewPath,
} from "./rules";
export {
  findPreview,
  issuePreview,
  recordPreviewActivity,
  recordPreviewFetch,
  recordPreviewOpen,
} from "./store";
