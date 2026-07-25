#!/usr/bin/env python3
"""
Bridge Arduino/STM32 USB-serial JSON lines → demo WebSocket hub (/ws/board).

  pip install websockets pyserial
  python3 serial_to_ws.py --port /dev/ttyUSB0 --ws ws://127.0.0.1:4173/ws/board

Also can replay a candump file with no hardware:

  python3 serial_to_ws.py --candump ../../samples/racepak-running-sample.log --ws ws://127.0.0.1:4173/ws/board
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import time

try:
    import websockets
except ImportError as exc:
    raise SystemExit("pip install websockets") from exc


LINE_RE = re.compile(
    r"^\((?P<ts>\d+(?:\.\d+)?)\)\s+\S+\s+(?P<id>[0-9A-Fa-f]+)#(?P<data>[0-9A-Fa-f]*)$"
)


async def pump_serial(port: str, baud: int, ws_url: str) -> None:
    import serial  # pyserial

    ser = serial.Serial(port, baud, timeout=0.2)
    async with websockets.connect(ws_url) as ws:
        await ws.send(json.dumps({"t": "hello", "board": "serial-bridge", "proto": 1}))
        while True:
            raw = ser.readline().decode("utf-8", errors="ignore").strip()
            if not raw:
                await asyncio.sleep(0.01)
                continue
            if raw.startswith("{"):
                await ws.send(raw)
            else:
                await ws.send(json.dumps({"t": "raw", "data": raw}))


async def pump_candump(path: str, ws_url: str, realtime: bool) -> None:
    async with websockets.connect(ws_url) as ws:
        await ws.send(
            json.dumps({"t": "hello", "board": "pi-candump", "mode": "replay", "proto": 1})
        )
        last_ts = None
        with open(path, "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                m = LINE_RE.match(line.strip())
                if not m:
                    continue
                ts = float(m.group("ts"))
                if realtime and last_ts is not None:
                    delay = max(0.0, ts - last_ts)
                    await asyncio.sleep(min(delay, 0.05))
                last_ts = ts
                msg = {
                    "t": "frame",
                    "id": m.group("id").upper(),
                    "data": m.group("data").upper(),
                    "ts": ts,
                }
                await ws.send(json.dumps(msg))
        # keep socket briefly so UI can settle
        await asyncio.sleep(1)


async def pump_sim(ws_url: str) -> None:
    import math

    async with websockets.connect(ws_url) as ws:
        await ws.send(json.dumps({"t": "hello", "board": "pi-sim", "mode": "sim", "proto": 1}))
        tick = 0
        while True:
            tick += 1
            s = math.sin(tick / 8)
            values = {
                "RPM": 800 + int((s + 1) * 1500),
                "CTS": round(180 + math.sin(tick / 20) * 8, 1),
                "BATT_VOLTAGE": round(13.2 + math.sin(tick / 15) * 0.4, 2),
                "MAP": 35 + int(math.sin(tick / 6) * 10),
                "OIL_PRESSURE": 40 + int(math.sin(tick / 10) * 5),
                "TARGET_AFR": 14.1,
                "AFR_AVERAGE": round(14.0 + math.sin(tick / 12) * 0.3, 2),
                "IGNITION_TIMING": round(22 + math.sin(tick / 9) * 3, 1),
                "PEDAL_POSITION": round(max(0.0, math.sin(tick / 7) * 40), 1),
                "FUEL_FLOW": round(12 + math.sin(tick / 11) * 4, 1),
                "MAT": 95,
                "BAR_PRESSURE": 100,
            }
            await ws.send(json.dumps({"t": "signals", "board": "pi-sim", "values": values}))
            await asyncio.sleep(0.2)


def main() -> None:
    p = argparse.ArgumentParser(description="AutoDash demo board → WebSocket bridge")
    p.add_argument("--ws", default="ws://127.0.0.1:4173/ws/board")
    p.add_argument("--port", help="serial device, e.g. /dev/ttyUSB0 or COM3")
    p.add_argument("--baud", type=int, default=115200)
    p.add_argument("--candump", help="path to candump log to replay")
    p.add_argument("--realtime", action="store_true", help="pace candump by timestamps")
    p.add_argument("--sim", action="store_true", help="software sim from Pi/PC")
    args = p.parse_args()

    if args.port:
        asyncio.run(pump_serial(args.port, args.baud, args.ws))
    elif args.candump:
        asyncio.run(pump_candump(args.candump, args.ws, args.realtime))
    elif args.sim:
        asyncio.run(pump_sim(args.ws))
    else:
        raise SystemExit("Pick --port, --candump, or --sim")


if __name__ == "__main__":
    main()
