# Computer import fixtures

These compact, synthetic fixtures contain invented dates, device names and identifiers.
They are format contract examples, not sanitized exports from a real vendor device. They do
not establish Oceanic+, Shearwater or Garmin compatibility.

- `si.uddf`: UDDF 3.2.3 structure, SI depth (m), temperature (K), pressure (Pa), tank volume
  (m³), gas ID references and a cross-midnight profile. Source specification:
  <https://www.streit.cc/resources/UDDF/v3.2.3/en/>.
- `multiple-computers.xml`: Subsurface XML, two recordings of one dive and two gas cylinders.
  Its date/time has no offset and remains unknown, including at the autumn DST transition.
  The serialized unit grammar is explicit, as in the upstream test dive at
  <https://github.com/subsurface/subsurface/blob/master/dives/test23.xml>.
- `labelled-imperial.csv`: DiveDay's own template with feet and an explicit offset or
  `unknown`. It is not a vendor mapping. Missing measurements stay null.

No FIT fixture is available. FIT detection returns `unsupported_fit`; no binary decoder or
vendor support is claimed. An adapter must use the official `@garmin/fitsdk` and pass a
representative, sanitized real-device fixture before that restriction is removed.
