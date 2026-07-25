import {
  decodeCandumpText,
  decodeRacepakFrame,
  formatSignal,
  parseCandumpLine,
  SIGNAL_META,
} from "./decoder.js";

const sampleSelect = document.getElementById("sampleSelect");
const fileInput = document.getElementById("fileInput");
const includeUnknown = document.getElementById("includeUnknown");
const statsEl = document.getElementById("stats");
const gaugesEl = document.getElementById("gauges");
const eventsBody = document.getElementById("eventsBody");
const eventsMeta = document.getElementById("eventsMeta");
const wsUrlInput = document.getElementById("wsUrl");
const wsConnectBtn = document.getElementById("wsConnect");
const wsDisconnectBtn = document.getElementById("wsDisconnect");
const wsStatus = document.getElementById("wsStatus");

let currentText = "";
let liveLatest = {};
let liveEvents = [];
let liveMode = false;
let socket = null;
let liveFrames = 0;
let liveBoardName = "board";

const defaultWs =
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
wsUrlInput.value = defaultWs;

async function loadSample(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  currentText = await res.text();
  liveMode = false;
  render();
}

function render() {
  if (!currentText.trim()) return;

  const result = decodeCandumpText(currentText, {
    includeUnknown: includeUnknown.checked,
    maxEvents: 400,
  });

  renderStats(result.summary);
  renderGauges(result.latest);
  renderEvents(result.events, result.summary);
}

function renderStats(summary) {
  statsEl.hidden = false;
  statsEl.innerHTML = [
    ["Frames", summary.frames],
    ["Decoded", summary.decodedFrames],
    ["Unknown", summary.unknownFrames],
    ["Duration", typeof summary.durationSec === "number" ? `${summary.durationSec.toFixed(2)}s` : summary.durationSec],
  ]
    .map(
      ([label, value]) => `
      <div class="stat">
        <strong>${value}</strong>
        <span>${label}</span>
      </div>`
    )
    .join("");
}

const SANITY = {
  RPM: [0, 12000],
  FUEL_FLOW: [0, 500],
  PEDAL_POSITION: [0, 100],
  TARGET_AFR: [8, 22],
  IGNITION_TIMING: [-20, 60],
  AFR_AVERAGE: [8, 30],
  MAP: [0, 300],
  MAT: [-40, 250],
  BAR_PRESSURE: [50, 120],
  CTS: [-40, 280],
  OIL_PRESSURE: [-20, 150],
  BATT_VOLTAGE: [0, 18],
};

function looksLikeWrongProtocol(latest) {
  let bad = 0;
  let seen = 0;
  for (const [name, entry] of Object.entries(latest)) {
    const range = SANITY[name];
    if (!range || !entry) continue;
    seen += 1;
    const value = typeof entry === "object" ? entry.value : entry;
    if (value < range[0] || value > range[1]) bad += 1;
  }
  return seen > 0 && bad / seen >= 0.5;
}

function normalizeLatest(latest) {
  const out = {};
  for (const [name, entry] of Object.entries(latest)) {
    out[name] =
      entry && typeof entry === "object" && "value" in entry
        ? entry
        : { value: entry };
  }
  return out;
}

function renderGauges(latest) {
  const normalized = normalizeLatest(latest);
  const names = Object.keys(SIGNAL_META);
  const warn = looksLikeWrongProtocol(normalized)
    ? `<p class="protocol-warn">Many values are out of range — this dump may not be Racepak scaling (common with some Holley captures). IDs match, encoding may differ.</p>`
    : "";
  const cards = names
    .map((name) => {
      const entry = normalized[name];
      const formatted = entry
        ? formatSignal(name, entry.value)
        : { text: "—", unit: SIGNAL_META[name].unit };
      return `
        <article class="gauge">
          <p class="name">${name.replaceAll("_", " ")}</p>
          <p class="value">${formatted.text} <span class="unit">${formatted.unit}</span></p>
        </article>`;
    })
    .join("");
  gaugesEl.innerHTML = warn + cards;
}

function renderEvents(events, summary) {
  eventsMeta.textContent = `Showing ${events.length} events · ${summary.knownSignalCount} live signals`;
  const rows = events
    .slice()
    .reverse()
    .map((ev) => {
      if (!ev.known) {
        return `
          <tr>
            <td>${Number(ev.ts).toFixed(3)}</td>
            <td>${ev.idHex || "—"}</td>
            <td class="unknown">unknown base ${ev.baseIdHex || "?"}</td>
          </tr>`;
      }
      const chips = (ev.signals || [])
        .map((s) => {
          const f = formatSignal(s.name, s.value);
          return `<span class="signal-chip">${s.name} ${f.text}${f.unit ? " " + f.unit : ""}</span>`;
        })
        .join("");
      return `
        <tr>
          <td>${Number(ev.ts).toFixed(3)}</td>
          <td>${ev.idHex || liveBoardName}</td>
          <td>${chips || "—"}</td>
        </tr>`;
    })
    .join("");
  eventsBody.innerHTML = rows || `<tr><td colspan="3">No decoded events</td></tr>`;
}

function renderLive() {
  liveMode = true;
  renderStats({
    frames: liveFrames,
    decodedFrames: liveFrames,
    unknownFrames: 0,
    durationSec: "LIVE",
  });
  renderGauges(liveLatest);
  renderEvents(liveEvents, {
    knownSignalCount: Object.keys(liveLatest).length,
  });
}

function applySignals(values, meta = {}) {
  const ts = meta.ts || Date.now() / 1000;
  const signals = [];
  for (const [name, value] of Object.entries(values || {})) {
    liveLatest[name] = { value, ts };
    signals.push({ name, value });
  }
  liveFrames += 1;
  liveEvents.push({
    ts,
    idHex: meta.idHex || meta.board || liveBoardName,
    known: true,
    signals,
  });
  if (liveEvents.length > 400) liveEvents.shift();
  renderLive();
}

function handleBoardMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  if (msg.t === "hello" && msg.board) {
    liveBoardName = msg.board;
    wsStatus.textContent = `Live — hello from ${msg.board}${msg.mode ? ` (${msg.mode})` : ""}`;
  }

  if (msg.t === "board_status") {
    wsStatus.textContent = msg.connected
      ? `Hub online — ${msg.boards} board(s) linked`
      : "Hub online — waiting for a board on /ws/board";
  }

  if (msg.t === "signal" && msg.name != null) {
    applySignals({ [msg.name]: msg.value }, msg);
  }

  if (msg.t === "signals" && msg.values) {
    liveBoardName = msg.board || liveBoardName;
    applySignals(msg.values, msg);
  }

  if (msg.t === "frame" && msg.id && msg.data) {
    const line = `(${Date.now() / 1000}) can0 ${msg.id}#${msg.data}`;
    const frame = parseCandumpLine(line);
    if (!frame) return;
    const decoded = decodeRacepakFrame(frame);
    liveFrames += 1;
    if (decoded.known) {
      const values = {};
      for (const s of decoded.signals) {
        values[s.name] = s.value;
        liveLatest[s.name] = { value: s.value, ts: frame.ts };
      }
      liveEvents.push({
        ts: frame.ts,
        idHex: frame.idHex,
        known: true,
        signals: decoded.signals,
      });
    } else if (includeUnknown.checked) {
      liveEvents.push({
        ts: frame.ts,
        idHex: frame.idHex,
        baseIdHex: decoded.baseId.toString(16).toUpperCase(),
        known: false,
        signals: [],
      });
    }
    if (liveEvents.length > 400) liveEvents.shift();
    renderLive();
  }
}

function setConnected(isConnected) {
  wsConnectBtn.disabled = isConnected;
  wsDisconnectBtn.disabled = !isConnected;
  wsUrlInput.disabled = isConnected;
}

function connectWs() {
  if (socket) socket.close();
  const url = wsUrlInput.value.trim();
  wsStatus.textContent = `Connecting ${url}…`;
  socket = new WebSocket(url);

  socket.addEventListener("open", () => {
    setConnected(true);
    liveLatest = {};
    liveEvents = [];
    liveFrames = 0;
    wsStatus.textContent = "Connected — waiting for telemetry";
  });

  socket.addEventListener("message", (ev) => {
    try {
      handleBoardMessage(JSON.parse(ev.data));
    } catch {
      wsStatus.textContent = "Connected — got non-JSON message";
    }
  });

  socket.addEventListener("close", () => {
    setConnected(false);
    wsStatus.textContent = "Disconnected — back to file/sample mode.";
  });

  socket.addEventListener("error", () => {
    wsStatus.textContent = "WebSocket error — check URL / same Wi‑Fi as board.";
  });
}

function disconnectWs() {
  if (socket) socket.close();
  socket = null;
}

sampleSelect.addEventListener("change", async () => {
  if (!sampleSelect.value) return;
  fileInput.value = "";
  try {
    await loadSample(sampleSelect.value);
  } catch (err) {
    eventsMeta.textContent = err.message;
  }
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  sampleSelect.value = "";
  currentText = await file.text();
  liveMode = false;
  render();
});

includeUnknown.addEventListener("change", () => {
  if (!liveMode && currentText) render();
});

wsConnectBtn.addEventListener("click", connectWs);
wsDisconnectBtn.addEventListener("click", disconnectWs);

// Auto-load racepak running sample for a one-tap phone demo
loadSample("./samples/racepak-running-sample.log").catch(() => {
  eventsMeta.textContent = "Pick a sample or upload a candump log.";
});
