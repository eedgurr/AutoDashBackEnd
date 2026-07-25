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

## BIN / XDF viewer

- Loads raw `.bin`, `.rom` or original calibration files entirely client-side
- 16-byte hex/ASCII view with jump and hex/ASCII search
- Scans for VIN-like 17-character ASCII strings
- Stages individual byte edits, supports undo and exports a modified copy
- Parses common TunerPro XDF 1.60/1.80 constants, flags and tables
- Selecting an XDF item jumps to and highlights its binary address
- Shows raw table cells and a heatmap; optionally evaluates simple arithmetic
  XDF equations containing `X`
- Includes an open synthetic BIN/XDF demo generated in the browser

This is a research viewer, not an ECU writer. XDF files vary, complex equations
and linked axes are only summarized, and address validity depends on using the
exact matching binary/strategy.

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
