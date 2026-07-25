# Definition workbook

`master-field-table.csv` is an Excel-friendly neutral research format. It is
not itself an XDF, ADX, A2L, ODX, DBC or flashing definition.

The columns separate concepts that those formats commonly need:

| Column | Purpose |
| --- | --- |
| `kind` | signal, PID, scalar, table, flag, patch or diagnostic routine |
| `source` | CAN, J1979, UDS, BIN, etc. |
| `address` | CAN ID, PID/DID/routine ID or binary address |
| `start`, `shape` | byte/bit location or table dimensions |
| `endian`, `signed` | raw storage interpretation |
| `scale`, `offset` | basic engineering conversion |
| `axes` | table axes or diagnostic request/session notes |

## Relationship to existing tools

- TunerPro **XDF** defines editable binary items, addresses, axes and conversion
  equations.
- TunerPro **ADX** defines acquisition streams, values, commands and dashboards.
- Universal Patcher uses configurable XML definitions/search recipes and can
  generate XDFs for supported GM binaries.
- DBC describes CAN messages/signals, but not ECU flashing or calibration
  checksums.
- ODX describes diagnostics; A2L describes measurement/calibration.

An exporter should only be added after required fields for the target format are
known. A generic spreadsheet cannot infer ECU strategy, segment layout,
checksums, seed/key access or safe flash sequences.

## Safe workflow

1. Identify ECU hardware, OS/strategy and calibration IDs.
2. Archive an original read and verify its hash.
3. Compare multiple known-good binaries/logs.
4. Document fields in this workbook.
5. Validate conversions in simulation/read-only mode.
6. Generate a target-specific definition.
7. Validate checksums and recovery before any write.

