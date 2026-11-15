# Computer import fixtures

The text fixtures below are compact, synthetic format examples with invented dates, device
names and identifiers. They do not establish Oceanic+ or Shearwater compatibility. The FIT
fixture has a separate, documented real-device provenance.

- `si.uddf`: UDDF 3.2.3 structure, SI depth (m), temperature (K), pressure (Pa), tank volume
  (m³), gas ID references and a cross-midnight profile. Source specification:
  <https://www.streit.cc/resources/UDDF/v3.2.3/en/>.
- `multiple-computers.xml`: Subsurface XML, two recordings of one dive and two gas cylinders.
  Its date/time has no offset and remains unknown, including at the autumn DST transition.
  The serialized unit grammar is explicit, as in the upstream test dive at
  <https://github.com/subsurface/subsurface/blob/master/dives/test23.xml>.
- `labelled-imperial.csv`: DiveDay's own template with feet and an explicit offset or
  `unknown`. It is not a vendor mapping. Missing measurements stay null.
- `multi-entry.zip`: synthetic archive transport, with `logs/si.uddf` copied verbatim from
  `si.uddf`, `logs/summary.csv` containing the labelled template's header and first row,
  `notes.txt` with invented instructions, and a four-byte JPEG marker in `photo.jpg`.
  It yields two dives and reports two ignored attachments. This is not a vendor archive
  or evidence of Oceanic+ packaging. The ZIP reader accepts stored/DEFLATE entries only,
  at most 20 entries, 5 MiB per entry and 10 MiB total expanded bytes, with a 200:1
  expansion-ratio ceiling (1 KiB minimum allowance). It rejects nested archives, unsafe
  paths, encryption, ZIP64, symlinks, inconsistent headers and bad CRCs, and does not
  retain any attachment. Actual inflater output is bounded independently of metadata.

The explicit CSV mapping tests are synthetic interchange cases, not PADI, SSI or other
vendor export evidence. Staff must choose the date order and measurement units; dates
without a time retain their calendar date with no manufactured midnight or instant.
Mapped column names and choices are retained as provenance. Unknown offsets and DST
ambiguity are preserved; archive entry hashes and entry-local ordinals preserve identity
when the same file is uploaded directly or inside a ZIP.
The mapping applies to generic CSV only: exact DiveDay template headers keep their labelled
units and ISO date grammar, including when uploaded alongside a generic mapped CSV.
An unmapped depth has no known source unit. A mapped but blank depth stays unknown while
retaining the explicit unit choice for that source column.

## Garmin Connect FIT fixture

`garmin-connect-summary-first.fit` is an anonymized Garmin Descent activity exported through
Garmin Connect, contributed by the DiveJSON authors under MIT. The original recorded product
ID is interpreted as `descentMk3` by the official Garmin SDK. This establishes the tested
single-session export shape only; it does not establish universal Garmin device support.

- Source revision: `divejson/divejson@5d1408dd06cb094f7a529b69330c95038840a0b3`.
- Source file: <https://github.com/divejson/divejson/blob/5d1408dd06cb094f7a529b69330c95038840a0b3/fixtures/fit/garmin-connect-summary-first.fit>.
- Git blob SHA-1: `c0f02cec614240c53b7d659e79adb4c243e4c3ac`.
- SHA-256: `ec2e68f700acd2d0098fb221ce8eab0f70b4d52f81e9c03c5c56d114b4b2c6ec`.
- Size: 79,083 bytes. Downloaded on 2026-11-15 after reviewing the source's license and
  anonymization statement; unchanged bytes are stored here.
- Source provenance: <https://github.com/divejson/divejson/blob/5d1408dd06cb094f7a529b69330c95038840a0b3/fixtures/README.md>.
- Source license scope: <https://github.com/divejson/divejson/blob/5d1408dd06cb094f7a529b69330c95038840a0b3/README.md#license>;
  its complete copyright/license notice is retained in `garmin-connect-LICENSE.txt`.

The source documents an allowlist of native `file_id`, `session`, `dive_summary`, `dive_gas`,
`record` and selected `event` fields. Positions, serials, user profiles, device names,
developer fields, unknown messages and the original filename were removed. Every retained
timestamp received the same shift, placing session start at `2000-01-01T00:00:00Z`; native
non-timestamp reading bytes and invalid sentinels were copied without numeric re-encoding.
Definitions and CRCs were rebuilt. The source explicitly contributes the fixture and expected
output under MIT, in addition to licensing its fixtures generally under MIT.

The file contains one `file_id`, one summary-first diving `session`, 3,267 `record` messages,
40 `event` messages, two `dive_gas` messages and two referenced `dive_summary` messages
(session and lap). Native maximum depth is 46.204 m, elapsed duration 4,279.267 s, and the
last depth sample is at 4,271 s; gas definitions are 21% and 50% oxygen. The adapter uses the
official `@garmin/fitsdk` and imports native depth/temperature, gas definitions, elapsed
session duration, session-linked maximum depth and recorded device identity. It warns that
additional telemetry, including gas-switch/decompression/alert data, is omitted. The file
contains no original local time/offset, tank telemetry, device settings or multi-session
evidence; those capabilities are not verified by this fixture. Tank telemetry and ambiguous
multi-session/multi-descent files are rejected by the current adapter.

The Encoder-generated edge cases in `fit.test.ts` are synthetic protocol tests, not additional
real-device compatibility evidence. No private or unlicensed forum attachment is used.
