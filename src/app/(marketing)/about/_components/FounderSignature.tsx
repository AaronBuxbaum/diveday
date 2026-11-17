/**
 * The founder's signature on `/about`, drawn as pen strokes rather than set in a
 * typeface (Aaron, 2026-11-17: a script font "doesn't look real"). Stroked in
 * `currentColor`, so it follows the theme. The name is read from the
 * screen-reader text beside it, so the drawing itself is hidden from them.
 */
export function FounderSignature({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 440 130"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path
        strokeWidth="3.2"
        d="M8 98 C 20 72 36 30 54 12 C 64 4 68 30 72 56 C 75 76 79 92 90 90"
      />
      <path strokeWidth="2.6" d="M26 66 C 44 56 70 52 98 58" />
      <path
        strokeWidth="2.8"
        d="M90 90 C 98 78 102 62 94 62 C 84 62 84 90 98 88 C 108 86 110 70 112 66 C 112 80 114 90 124 84 C 130 80 132 70 134 68 C 134 78 140 86 150 80 C 158 74 154 64 146 68 C 140 72 142 90 156 88 C 168 86 170 70 172 66 C 172 80 176 92 186 88 C 196 84 198 70 196 68 C 196 82 204 90 216 84"
      />
      <path
        strokeWidth="3"
        d="M226 12 C 224 40 222 70 220 100 C 238 100 262 90 258 70 C 255 54 232 52 226 56 C 246 50 262 36 250 22 C 244 14 232 14 226 12"
      />
      <path
        strokeWidth="2.8"
        d="M258 90 C 262 76 264 66 268 66 C 270 80 272 91 284 89 C 292 87 296 75 298 67"
      />
      <path strokeWidth="2.6" d="M306 68 C 316 80 330 92 342 98 M344 66 C 336 80 326 94 314 100" />
      <path
        strokeWidth="2.8"
        d="M354 94 C 354 62 356 36 358 24 C 360 18 364 26 362 44 C 360 66 358 86 360 91 C 366 95 378 85 376 73 C 374 65 364 69 362 82 C 366 88 376 88 384 84 C 390 80 390 70 392 66 C 392 80 396 91 406 87 C 414 83 416 71 418 67 C 418 81 422 91 432 87 C 438 84 440 78 438 72"
      />
      <path strokeWidth="2.4" d="M30 116 C 140 102 300 124 436 104" />
    </svg>
  );
}
