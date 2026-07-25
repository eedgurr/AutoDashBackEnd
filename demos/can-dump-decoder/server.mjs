#!/usr/bin/env node
/**
 * Static demo server + live board WebSocket hub.
 *
 *   node server.mjs [port]
 *
 * Endpoints:
 *   GET  /            web UI
 *   WS   /ws          phone/desktop UI clients
 *   WS   /ws/board    ESP32 / Pi / bridge firmware
 *
 * Optional sim board (no hardware):
 *   AUTODASH_SIM_BOARD=1 node server.mjs
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { attachWebSocketServer } from "./wsLite.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const port = Number(process.argv[2] || process.env.PORT || 4173);
const simBoard = process.env.AUTODASH_SIM_BOARD === "1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

const uiClients = new Set();
const boardClients = new Set();

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const rel = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(root, rel));

  if (!filePath.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
});

function broadcastUi(obj) {
  for (const client of uiClients) {
    try {
      client.send(obj);
    } catch {
      uiClients.delete(client);
    }
  }
}

attachWebSocketServer(server, {
  onConnection(client, req) {
    const isBoard = (req.url || "").startsWith("/ws/board");
    if (isBoard) {
      boardClients.add(client);
      client.send({
        t: "hello",
        role: "hub",
        proto: 1,
        msg: "board connected",
      });
      broadcastUi({
        t: "board_status",
        connected: true,
        boards: boardClients.size,
      });
      client.onMessage = (text) => {
        // Forward board telemetry to all UIs
        let msg = text;
        try {
          msg = JSON.parse(text);
        } catch {
          msg = { t: "raw", data: text };
        }
        broadcastUi(msg);
      };
      client.onClose = () => {
        boardClients.delete(client);
        broadcastUi({
          t: "board_status",
          connected: boardClients.size > 0,
          boards: boardClients.size,
        });
      };
      return;
    }

    uiClients.add(client);
    client.send({
      t: "hello",
      role: "hub",
      proto: 1,
      boards: boardClients.size,
      sim: simBoard,
    });
    client.onClose = () => {
      uiClients.delete(client);
    };
  },
});

server.listen(port, "0.0.0.0", () => {
  console.log(`CAN Dump Decoder demo → http://127.0.0.1:${port}`);
  console.log(`UI WebSocket          → ws://127.0.0.1:${port}/ws`);
  console.log(`Board WebSocket       → ws://127.0.0.1:${port}/ws/board`);
  if (simBoard) console.log("Sim board enabled (fake RPM/CTS/…)");
});

if (simBoard) {
  let tick = 0;
  setInterval(() => {
    tick += 1;
    const rpm = 800 + Math.round((Math.sin(tick / 8) + 1) * 1500);
    const cts = 180 + Math.sin(tick / 20) * 8;
    const batt = 13.2 + Math.sin(tick / 15) * 0.4;
    broadcastUi({
      t: "signals",
      board: "sim",
      values: {
        RPM: rpm,
        CTS: Number(cts.toFixed(1)),
        BATT_VOLTAGE: Number(batt.toFixed(2)),
        MAP: 35 + Math.round(Math.sin(tick / 6) * 10),
        OIL_PRESSURE: 40 + Math.round(Math.sin(tick / 10) * 5),
        TARGET_AFR: 14.1,
        AFR_AVERAGE: 14.0 + Math.sin(tick / 12) * 0.3,
        IGNITION_TIMING: 22 + Math.sin(tick / 9) * 3,
        PEDAL_POSITION: Math.max(0, Math.sin(tick / 7) * 40),
        FUEL_FLOW: 12 + Math.sin(tick / 11) * 4,
        MAT: 95,
        BAR_PRESSURE: 100,
      },
    });
  }, 200);
}
