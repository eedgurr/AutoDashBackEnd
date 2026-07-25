# CAN Dump Decoder Demo

Phone/cloud-friendly demo that decodes Racepak/Holley `candump` logs using the same ID mask (`0xfffff800`) and big-endian `/256` scaling as `src/CAN/racepakDecoder.js`.

## Run

```bash
# Web UI (mobile-friendly)
node demos/can-dump-decoder/server.mjs
# open http://127.0.0.1:4173

# CLI snapshot (works in cloud chat / SSH)
node demos/can-dump-decoder/cli.mjs demos/can-dump-decoder/samples/racepak-running-sample.log
```

Or via npm:

```bash
npm run demo:can-decoder
npm run demo:can-decoder:cli
```

## Samples

Bundled excerpts from `can_dumps/`:

- `samples/racepak-running-sample.log`
- `samples/racepak-idle-sample.log`
- `samples/holley-running-sample.log`

Upload a full candump from the UI if you want the entire capture.

## Notes

- Racepak samples decode to sensible dash values (RPM, AFR, CTS, etc.).
- Some Holley captures in `can_dumps/` share similar 29-bit IDs but do **not** use the same `/256` int32 scaling (values look like floats). The UI warns when readings are out of sane range.
- AN400 little-endian maps from `src/CAN/an400Decorder.js` are not wired into this demo yet.
