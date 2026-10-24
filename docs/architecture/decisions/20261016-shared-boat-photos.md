# 20261016-shared-boat-photos — A diver may share a recap photo with everyone on the boat

- **Status:** Accepted
- **Date:** 2026-10-16
- **Extends:** [20260723-post-trip-recap](20260723-post-trip-recap.md); decision H-129

## Context

A diver's recap photos stayed on their own recap, while a crew photo (`trip_recap_photos`) reached
every diver on the departure. The diver with the camera is the one whose pictures the rest of the
boat wants (fifth-loop ideas, item 42). Those pictures carry other divers' faces, so the owner was
asked whether a diver may share them and chose: yes, opt-in per photo by the sharer, off by
default, with staff able to delete (H-129).

## Decision

1. **One nullable column, `recap_photos.shared_with_boat_at`.** It is set at upload from the
   sharer's own tick, "Share with everyone on this boat", which starts unticked on every pick.
   Nothing else sets it, and no staff surface can share a diver's photo. **The tick is offered
   and honored only through the diver's readiness link** (`uploadRecapPhotoFromReadyAction`,
   security review r5-4 F3); an upload through a forwardable `/recap` link never shares.
2. **A shared photo shows on the recap of every other seat on the same departure**, under "From the
   boat", with the sharer's first name and nothing else about them. The read is the recap's own
   departure, so it never reaches another departure or another shop.
3. **It leaves when the sharer leaves the boat.** The read requires the sharer's seat to be one a
   recap would show (not cancelled, not a no-show, not left at the dock, not held) and the person
   neither deleted nor erased. Erasure already deletes the photo rows (`src/db/anonymize.ts`).
4. **Moderation is the delete staff already have.** The close-out gallery marks a shared photo, and
   its delete asks whether to remove it from every recap on this boat. No approval queue.
5. **The cap counts the sharer's own photos.** Photos shared by others never use up a diver's room.

## Alternatives considered

- **Staff approve each shared photo first.** A queue on the evening close for a keepsake; H-129
  declined it.
- **No sharing.** Leaves the best photos of the day on one recap.
- **Share every photo by default.** Puts other people's faces on pages without anyone choosing it.

## Consequences

- A recap link, which is forwardable, now carries photos of other divers that their sharer chose to
  publish to the boat, with the sharer's first name. The page was already noindex and carries no
  other diver's data.
- The sharer can withdraw a photo they shared: "Stop sharing" on their own shared photo, on
  `/recap/<token>` and the `/ready` after-state, clears the column (`unshareRecapPhoto`, issue
  #2806). Only the uploading booking can clear it; the photo stays on the sharer's recap.
  Withdrawing is the safe direction, so the forwardable recap link may do it. Staff can still
  delete.
- Revisiting this (for example, per-diver consent from people in the photo) would add a consent
  record per subject; the column stays the sharer's half of it.
