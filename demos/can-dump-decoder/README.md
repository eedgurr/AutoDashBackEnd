# CAN Dump Decoder Demo

Phone/cloud-friendly demo that decodes Racepak/Holley `candump` logs using the same ID mask (`0xfffff800`) and big-endian `/256` scaling as `src/CAN/racepakDecoder.js`.

Also speaks a **live board protocol** so ESP32 / Pi / STM32 / Arduino can drive the same gauges.

## Run (file mode)

```bash
node demos/can-dump-decoder/server.mjs
# open http://127.0.0.1:4173

node demos/can-dump-decoder/cli.mjs demos/can-dump-decoder/samples/racepak-running-sample.log
```

## Run (live sim board — no hardware)

```bash
AUTODASH_SIM_BOARD=1 npm run demo:can-decoder
```

Open the UI → tap **Connect** on the Live board WebSocket → gauges animate.

## Dev boards

See [`boards/README.md`](./boards/README.md) for:

- ESP32 SoftAP / TWAI sketch
- Arduino + STM32 USB-serial sims
- Pi `serial_to_ws.py` bridge / candump replay

## Samples

Bundled excerpts from `can_dumps/`:

- `samples/racepak-running-sample.log`
- `samples/racepak-idle-sample.log`
- `samples/holley-running-sample.log`

## Notes

- Racepak samples decode to sensible dash values (RPM, AFR, CTS, etc.).
- Some Holley captures in `can_dumps/` share similar 29-bit IDs but do **not** use the same `/256` int32 scaling. The UI warns when readings are out of sane range.
- AN400 little-endian maps from `src/CAN/an400Decorder.js` are not wired into this demo yet.
