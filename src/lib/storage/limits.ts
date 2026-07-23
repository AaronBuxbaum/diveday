/**
 * Image upload constraints shared by server-side validation
 * (`src/lib/storage/index.ts`) and client-side pre-checks (form components
 * under `src/app/**`). Split into its own file, with no server-only imports,
 * specifically so a "use client" component can import it directly rather than
 * pulling in `src/lib/storage/index.ts`, which reads `process.env` for the
 * Blob token and has no business being in a client bundle (CR-011).
 */
export const ALLOWED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * A single course-editor submission proxies its files through one Server
 * Action request, whose body Next.js caps globally
 * (`next.config.ts`'s `experimental.serverActions.bodySizeLimit`). Capping how
 * many *new* gallery files one submission accepts keeps that global limit from
 * having to absorb an unbounded multi-file body — the amplifying case CR-011
 * exists to close — while still letting staff add more than one photo at a
 * time. The existing eight-photo total cap (`MAX_COURSE_IMAGES` in
 * `src/lib/courses.ts`) is unrelated: this bounds one upload, not the gallery.
 */
export const MAX_NEW_GALLERY_IMAGES_PER_SUBMISSION = 2;
