# Offline activation checkpoint

This is work in progress, not a pull request or deployment candidate. No production state was changed. The normal runtime enables witnessed sync; tests use a fixture switch. Sync protocol 2 is refused while protocol 1 remains in use by snapshot readers.

The local changes advance generation for diver merges, material boat changes, trip cancellation/reinstatement, and seat cancellation/restoration/rebooking. Eight disposable PostgreSQL cases passed, including gated merge transactions, boat swap and revert, trip cancellation/reinstatement, and seat restore. Existing live evidence must remain authoritative; excluded offline evidence remains history and may still require an at-sea uncertainty hold.

Open work at this checkpoint: broader unit, browser and CI verification has not completed. Offline crew and checklist captures have no verified witness and remain for manual live review; the checklist does not yet have a local resolution control. Snapshot acquisition and mixed queue must be checked end-to-end. Restore cutover remains unsupported. Do not use the checkpoint as evidence of a safe deployment.
