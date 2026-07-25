# Try this demo with ESP32 / Pi / STM32 / Arduino

Same gauge UI. Boards speak a tiny JSON protocol over WebSocket (ESP32) or USB-serial (Arduino/STM32 → Pi bridge).

## Protocol (`proto: 1`)

Board → hub/UI:

```json
{"t":"hello","board":"esp32","mode":"sim","proto":1}
{"t":"signals","board":"esp32","values":{"RPM":2500,"CTS":190,"BATT_VOLTAGE":13.6}}
{"t":"signal","name":"RPM","value":2500}
{"t":"frame","id":"1E0012D0","data":"3D750CD300052C34"}
```

- `signals` / `signal` — already decoded (easiest)
- `frame` — raw CAN; the web UI runs the Racepak decoder

Hub ports (Node demo server):

| URL | Who connects |
|---|---|
| `ws://<host>:4173/ws` | Phone / desktop UI |
| `ws://<host>:4173/ws/board` | ESP32 / Pi bridge |

## Easiest paths (no car CAN yet)

### A) Software sim board (laptop/cloud)

```bash
AUTODASH_SIM_BOARD=1 npm run demo:can-decoder
```

Open the UI → **Connect** (default `ws://…/ws`) → gauges move.

### B) ESP32 SoftAP (phone beside the board)

1. Flash `boards/esp32/AutoDashDemoBoard/` (Arduino IDE + WebSockets lib, or PlatformIO).
2. Phone joins Wi‑Fi **`AutoDashDemo` / `autodash1`**.
3. In the UI (served from a PC on that network, or change sketch to STA on home Wi‑Fi), set:

   `ws://192.168.4.1:81/`

   Note: SoftAP mode means the phone is on the ESP32 network, so use a UI copy opened from that network (or set `USE_STA 1` so ESP32 and phone share home Wi‑Fi).

### C) Arduino / STM32 USB serial → Pi/PC bridge

```bash
# terminal 1
npm run demo:can-decoder

# terminal 2
pip install websockets pyserial
python3 boards/pi/serial_to_ws.py --port /dev/ttyUSB0 --ws ws://127.0.0.1:4173/ws/board
```

Flash `boards/arduino/AutoDashSerialSim` or `boards/stm32/AutoDashSerialSim`.

### D) Raspberry Pi replay / live SocketCAN later

```bash
python3 boards/pi/serial_to_ws.py --sim --ws ws://127.0.0.1:4173/ws/board
python3 boards/pi/serial_to_ws.py --candump ../../samples/racepak-running-sample.log --realtime
# later: candump can0 | … or extend script to python-can
```

## When you add CAN hardware

| Board | Transceiver | Sketch change |
|---|---|---|
| ESP32 | SN65HVD230 / TJA1050 on TWAI pins | `#define USE_SIM 0` in ESP32 sketch |
| Pi | Waveshare CAN HAT | Feed `candump` / `python-can` into `serial_to_ws.py` as `frame` messages |
| STM32 | onboard CAN or transceiver | Replace sim with bxCAN RX → `frame` JSON |
| Arduino | MCP2515 shield | Same as STM32 via SPI CAN lib |

## Android vs iPhone with a real ESP32

| | Android | iPhone |
|---|---|---|
| Join ESP32 SoftAP + open UI WS | Yes | Yes |
| USB serial to phone | OTG apps possible | Hard |
| Classic BT SPP ELM | Yes | No |
| Ideal first try | STA on home Wi‑Fi + phone on same LAN | Same (Wi‑Fi) |

## Suggested order at the bench

1. Sim board in Node (prove UI)  
2. ESP32 SoftAP/STA sim (prove phone ↔ MCU)  
3. ESP32 TWAI listen-only on car/bench CAN  
4. Pi SocketCAN + AutoDash backend  
5. Only then OBD request/response / special functions
