/** storage public contract. Internals are imported only within this module. */
export type {
  DiveSitePhotoResult,
  DiveSitePhotos,
  ExistingDiveSitePhotos,
} from "./dive-site-photos";
export {
  abandonDiveSitePhotos,
  addedDiveSitePhotos,
  supersededDiveSitePhotos,
  uploadDiveSitePhotos,
} from "./dive-site-photos";
export type { IngestResult } from "./ingest-url";
export { ingestImageUrl } from "./ingest-url";
