# Live manifest server

This server-only feature owns purpose-separated opaque session handles and projection and erasure-recovery proof helpers. Handles are not bearer credentials, and proofs do not establish current authorization on their own.

The recovery route derives the shop and session from the live staff gate and reads the erasure epoch before issuing a short-lived challenge-bound observation. Projection proof helpers are not yet connected to a server-authored projection or the manifest. A future caller must authorize the live staff session, validate shop and trip ownership, bind exact server-produced bytes and trip-specific expiry, and recheck the current erasure epoch. No raw session identifiers or server secrets may cross the client boundary.
