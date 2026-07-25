# AutoDash CAN Analyzer Demo

Trace-first CAN datalog tool (USB-analyzer style) for Racepak/Holley `candump` logs and live boards.

## What it is

Workflow mirrors OEM CAN reverse engineering:

1. **Capture / load** a datalog  
2. **ID catalog** — unique IDs, counts, Hz  
3. **Trace** — time, Δms, raw bytes, changed-byte highlight  
4. **Inspect** — payload + mapped decode + encoding guesses (`i32BE/256`, float, LE/BE)  
5. **Log viewer** — overlay decoded signals or raw `CAN ID / byte` channels, zoom, tap-to-seek  
6. **Mapped signals** — known Racepak map (same as Pi dash)

The chart normalizes each channel by default so RPM, voltage, temperature, and
raw bytes can be compared for correlated movement. Disable **Normalize** to
show all selected channels on one shared numeric scale.

## Definition / tuning research workbench

- Square-corner dark UI
- Editable master field table
- Flexible CSV import and Excel-compatible CSV export
- Project JSON export
- Hex/endian/signed/scale/offset decode calculator
- Editable RPM × load calibration-table simulator with interpolation and heatmap

See [`definitions/master-field-table.csv`](./definitions/master-field-table.csv)
and [`definitions/README.md`](./definitions/README.md). The neutral workbook is
intentionally not labeled as XDF: XDF/ADX, DBC, A2L and ODX describe different
layers, and safe flashing additionally needs target-specific segment,
checksum, security and recovery logic.

## Run

```bash
npm run demo:can-decoder
# http://127.0.0.1:4173

AUTODASH_SIM_BOARD=1 npm run demo:can-decoder:sim
# UI → Connect on Live WS

node demos/can-dump-decoder/cli.mjs demos/can-dump-decoder/samples/racepak-running-sample.log
```

## Dev boards

See [`boards/README.md`](./boards/README.md) for ESP32 / Arduino / STM32 / Pi bridges using the same JSON protocol.

## Notes

- Racepak samples decode cleanly with BE int32 `/256`.
- Some Holley dumps share IDs but different encoding — use **Inspect → encoding guesses**.
- AN400 LE maps not wired yet.
