# Computer dives

Staff-only personal computer evidence, imported after a server-validated preview and confirmation.
This module never writes trip dives, recency, readiness, roll call or no-fly inputs. Files are parsed
in memory and discarded. A request key binds one selection; fingerprints deduplicate within one
shop and person, including deleted records. Deletion is reversible. Erasure removes the records.

Online-logbook choices are user-declared beta provenance, separate from detected file format.
PADI and SSI choices describe manual transfer; neither claims a verified native export or API.
Generic CSV needs explicit column, date and unit mapping. Calendar-only dates stay calendar-only.
The labelled DiveDay template retains its own units even when a mapping is supplied for another file.
Bounded ZIPs are parsed in memory; archive and extracted entries deduplicate against each other.
Exact identity excludes transport metadata. Date-only rows without source IDs include underlying
file identity and row ordinal, so two otherwise identical dives are not silently merged.

Summary CSV export uses the same live authorization as the complete JSON backup, escapes spreadsheet
formulas and excludes profiles/gases. The JSON backup retains the complete recording. No provider
choice connects an account, fetches remote data, or verifies vendor compatibility. See
[the interchange decision](../../../../docs/architecture/decisions/20261115-online-logbook-file-interchange.md)
and the parser fixture README for the tested compatibility scope.

A diver's recap reads only their live personal recordings matching the recap date (`recapComputerDives`),
limited to six. A known instant is matched in the shop's timezone; an unknown-zone wall date is retained
without conversion. Source dates and times are shown with known or unknown timezone attribution.
The separate computer-recording section explicitly states that these date-level records are not linked
to the departure or its logbook entry. Crew recordings are never substituted. Profiles and facts stay
out of the printed/countersigned logbook and saved postcard, and a recording without samples has no chart.
