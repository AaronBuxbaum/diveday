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
[the interchange decision](../../../docs/architecture/decisions/20261115-online-logbook-file-interchange.md)
and the parser fixture README for the tested compatibility scope.

A diver's own recap reads their live dives for the trip's calendar day (`recapComputerDives`) and draws
the depth profile and facts as "From your dive computer". It is shown to the diver as their evidence,
never printed on the logbook sheet, and a recording with no samples shows its facts without a chart.
