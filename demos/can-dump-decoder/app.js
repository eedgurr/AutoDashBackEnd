import {
  SIGNAL_META,
  analyzeCandumpText,
  decodeRacepakFrame,
  formatDataBytes,
  formatSignal,
  guessEncodings,
  parseCandumpLine,
} from "./decoder.js";
import { createLogChart } from "./logChart.js";

const sampleSelect = document.getElementById("sampleSelect");
const fileInput = document.getElementById("fileInput");
const wsUrlInput = document.getElementById("wsUrl");
const wsConnectBtn = document.getElementById("wsConnect");
const wsDisconnectBtn = document.getElementById("wsDisconnect");
const wsStatus = document.getElementById("wsStatus");
const statsEl = document.getElementById("stats");
const catalogBody = document.getElementById("catalogBody");
const catalogMeta = document.getElementById("catalogMeta");
const traceBody = document.getElementById("traceBody");
const traceMeta = document.getElementById("traceMeta");
const traceScroll = document.getElementById("traceScroll");
const inspectBody = document.getElementById("inspectBody");
const inspectMeta = document.getElementById("inspectMeta");
const signalsEl = document.getElementById("signals");
const idFilter = document.getElementById("idFilter");
const onlyChanged = document.getElementById("onlyChanged");
const onlyKnown = document.getElementById("onlyKnown");
const followTail = document.getElementById("followTail");

const state = {
  frames: [],
  catalog: [],
  latestSignals: {},
  summary: null,
  selectedIndex: null,
  live: false,
  socket: null,
  boardName: "board",
};
let chartViewer = null;

wsUrlInput.value = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

function setAnalysis(analysis, { live = false } = {}) {
  state.frames = analysis.frames;
  state.catalog = analysis.catalog;
  state.latestSignals = analysis.latestSignals;
  state.summary = analysis.summary;
  state.live = live;
  if (state.selectedIndex == null && state.frames.length) {
    state.selectedIndex = state.frames.length - 1;
  }
  renderAll();
}

function renderAll() {
  renderStats();
  renderCatalog();
  renderTrace();
  renderInspect();
  renderSignals();
  chartViewer?.refresh();
}

function renderStats() {
  const s = state.summary || {
    frames: 0,
    uniqueIds: 0,
    decodedFrames: 0,
    unknownFrames: 0,
    durationSec: 0,
    knownSignalCount: 0,
  };
  const duration =
    state.live && typeof s.durationSec !== "number"
      ? "LIVE"
      : typeof s.durationSec === "number"
        ? `${s.durationSec.toFixed(3)}s`
        : String(s.durationSec);
  statsEl.innerHTML = [
    ["Frames", s.frames],
    ["Unique IDs", s.uniqueIds ?? state.catalog.length],
    ["Mapped", s.decodedFrames],
    ["Unknown", s.unknownFrames],
    ["Signals", s.knownSignalCount],
    ["Span", duration],
  ]
    .map(
      ([label, value]) => `
      <div class="stat"><strong>${value}</strong><span>${label}</span></div>`
    )
    .join("");
}

function filterText() {
  return (idFilter.value || "").trim().toUpperCase();
}

function frameMatchesFilters(frame) {
  const q = filterText();
  if (q && !frame.idHex.includes(q) && !(frame.baseIdHex || "").includes(q)) {
    return false;
  }
  if (onlyChanged.checked && !frame.changed) return false;
  if (onlyKnown.checked && !frame.known) return false;
  return true;
}

function renderCatalog() {
  const q = filterText();
  const rows = state.catalog.filter((c) => {
    if (!q) return true;
    return c.idHex.includes(q) || (c.baseIdHex || "").includes(q);
  });
  catalogMeta.textContent = `${rows.length} IDs`;
  catalogBody.innerHTML = rows
    .map((c) => {
      const map = c.known ? (c.signals[0] || "mapped") : "—";
      return `
        <tr class="clickable ${state.frames[state.selectedIndex]?.idHex === c.idHex ? "selected" : ""}"
            data-id="${c.idHex}">
          <td class="${c.known ? "known" : "unknown"}">${c.idHex}</td>
          <td>${c.count}</td>
          <td>${c.hz ? c.hz.toFixed(1) : "—"}</td>
          <td>${map}</td>
        </tr>`;
    })
    .join("");
}

function renderTrace() {
  const filtered = state.frames.filter(frameMatchesFilters);
  const view = filtered.slice(-500);
  traceMeta.textContent = `${view.length}/${filtered.length} shown`;

  traceBody.innerHTML = view
    .map((f) => {
      const bytes = formatDataBytes(f.dataHex, f.changeMask)
        .map(
          (b) =>
            `<span class="byte ${b.changed ? "changed" : ""}">${b.hex}</span>`
        )
        .join("");
      const decode = f.known
        ? f.signals
            .map((s) => {
              const fmt = formatSignal(s.name, s.value);
              return `<span class="decode-chip">${s.name}=${fmt.text}</span>`;
            })
            .join("")
        : `<span class="unknown">base ${f.baseIdHex}</span>`;
      const delta =
        f.deltaMs == null ? "—" : f.deltaMs < 10 ? f.deltaMs.toFixed(2) : f.deltaMs.toFixed(1);
      return `
        <tr class="clickable ${f.index === state.selectedIndex ? "selected" : ""}"
            data-index="${f.index}">
          <td>${f.index}</td>
          <td>${f.ts.toFixed(4)}</td>
          <td>${delta}</td>
          <td class="${f.known ? "known" : "unknown"}">${f.idHex}</td>
          <td>${f.dlc}</td>
          <td>${bytes}</td>
          <td>${decode}</td>
        </tr>`;
    })
    .join("");

  if (followTail.checked) {
    traceScroll.scrollTop = traceScroll.scrollHeight;
  }
}

function renderInspect() {
  const frame =
    state.selectedIndex != null
      ? state.frames.find((f) => f.index === state.selectedIndex)
      : null;
  if (!frame) {
    inspectMeta.textContent = "Select a frame";
    inspectBody.innerHTML =
      '<p class="muted">Click a trace row or ID. Highlighted bytes changed vs previous same ID — classic OEM CAN RE cue.</p>';
    return;
  }

  inspectMeta.textContent = `#${frame.index} ${frame.idHex}`;
  const byteCells = formatDataBytes(frame.dataHex, frame.changeMask)
    .map(
      (b) => `
      <div class="byte-cell ${b.changed ? "changed" : ""}">
        <small>B${b.index}</small>${b.hex}
      </div>`
    )
    .join("");

  const mapped = frame.known
    ? frame.signals
        .map((s) => {
          const fmt = formatSignal(s.name, s.value);
          return `<div><span>${s.name}</span><span>${fmt.text} ${fmt.unit} @B${s.start}</span></div>`;
        })
        .join("")
    : "<div><span>map</span><span class='unknown'>unmapped — use guesses below</span></div>";

  const guesses = guessEncodings(frame.data)
    .slice(0, 24)
    .map((g) => `<div><span>${g.label}</span><span>${g.text}</span></div>`)
    .join("");

  inspectBody.innerHTML = `
    <div class="kv">
      <span>CAN ID</span><span>${frame.idHex}</span>
      <span>Base (mask)</span><span>${frame.baseIdHex}</span>
      <span>DLC</span><span>${frame.dlc}</span>
      <span>Δ same ID</span><span>${frame.deltaMs == null ? "—" : frame.deltaMs.toFixed(3) + " ms"}</span>
      <span>Changed</span><span>${frame.changed ? "yes" : "no"}</span>
    </div>
    <p class="muted">Payload bytes</p>
    <div class="byte-row">${byteCells}</div>
    <p class="muted">Mapped decode</p>
    <div class="kv">${mapped}</div>
    <p class="muted">Encoding guesses (OEM RE)</p>
    <div class="guess-list">${guesses}</div>
  `;
}

function renderSignals() {
  const names = Object.keys(SIGNAL_META);
  const latest = state.latestSignals || {};
  const values = names.map((n) => {
    const entry = latest[n];
    return entry && typeof entry === "object" ? entry.value : entry;
  });
  const saneCount = values.filter((v, i) => {
    const name = names[i];
    if (v == null) return true;
    const ranges = {
      RPM: [0, 12000],
      CTS: [-40, 280],
      BATT_VOLTAGE: [0, 18],
      PEDAL_POSITION: [0, 100],
    };
    const r = ranges[name];
    if (!r) return true;
    return v >= r[0] && v <= r[1];
  }).length;
  const warn =
    Object.keys(latest).length >= 4 && saneCount < names.length / 2
      ? `<p class="warn">Many mapped values look wrong — IDs may match Racepak layout but encoding differs (seen on some Holley dumps). Use Inspect guesses.</p>`
      : "";

  signalsEl.innerHTML =
    warn +
    names
      .map((name) => {
        const entry = latest[name];
        const value = entry && typeof entry === "object" ? entry.value : entry;
        const fmt = value == null ? { text: "—", unit: SIGNAL_META[name].unit } : formatSignal(name, value);
        return `
          <article class="signal">
            <p class="name">${name.replaceAll("_", " ")}</p>
            <p class="value">${fmt.text} <span class="unit">${fmt.unit}</span></p>
          </article>`;
      })
      .join("");
}

function selectFrame(index) {
  state.selectedIndex = index;
  renderAll();
}

function selectId(idHex) {
  for (let i = state.frames.length - 1; i >= 0; i -= 1) {
    if (state.frames[i].idHex === idHex) {
      selectFrame(state.frames[i].index);
      chartViewer?.focusId(idHex);
      followTail.checked = false;
      return;
    }
  }
}

catalogBody.addEventListener("click", (ev) => {
  const tr = ev.target.closest("tr[data-id]");
  if (!tr) return;
  selectId(tr.dataset.id);
});

traceBody.addEventListener("click", (ev) => {
  const tr = ev.target.closest("tr[data-index]");
  if (!tr) return;
  followTail.checked = false;
  selectFrame(Number(tr.dataset.index));
});

["input", "change"].forEach((evt) => {
  idFilter.addEventListener(evt, () => renderAll());
  onlyChanged.addEventListener(evt, () => renderAll());
  onlyKnown.addEventListener(evt, () => renderAll());
});

async function loadSample(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  const text = await res.text();
  const analysis = analyzeCandumpText(text);
  state.selectedIndex = analysis.frames.length ? analysis.frames.length - 1 : null;
  setAnalysis(analysis, { live: false });
  wsStatus.textContent = `File mode · ${url.split("/").pop()}`;
}

sampleSelect.addEventListener("change", async () => {
  if (!sampleSelect.value) return;
  fileInput.value = "";
  try {
    await loadSample(sampleSelect.value);
  } catch (err) {
    wsStatus.textContent = err.message;
  }
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const text = await file.text();
  const analysis = analyzeCandumpText(text);
  state.selectedIndex = analysis.frames.length ? analysis.frames.length - 1 : null;
  setAnalysis(analysis, { live: false });
  wsStatus.textContent = `File mode · ${file.name}`;
});

function rebuildLiveCatalog() {
  const map = new Map();
  let firstTs = null;
  let lastTs = null;
  let decoded = 0;
  let unknown = 0;
  for (const f of state.frames) {
    if (firstTs == null) firstTs = f.ts;
    lastTs = f.ts;
    if (f.known) decoded += 1;
    else unknown += 1;
    const st = map.get(f.idHex) || {
      idHex: f.idHex,
      baseIdHex: f.baseIdHex,
      count: 0,
      known: f.known,
      signals: [],
      lastDataHex: "",
      lastTs: 0,
      hz: 0,
    };
    st.count += 1;
    st.lastDataHex = f.dataHex;
    st.lastTs = f.ts;
    st.known = f.known;
    st.signals = (f.signals || []).map((s) => s.name);
    map.set(f.idHex, st);
  }
  const duration = firstTs != null && lastTs != null ? Math.max(lastTs - firstTs, 0.001) : 1;
  state.catalog = [...map.values()]
    .map((st) => ({ ...st, hz: st.count / duration }))
    .sort((a, b) => b.count - a.count);
  state.summary = {
    frames: state.frames.length,
    uniqueIds: state.catalog.length,
    decodedFrames: decoded,
    unknownFrames: unknown,
    durationSec: "LIVE",
    knownSignalCount: Object.keys(state.latestSignals).length,
  };
}

function pushLiveFrame(partial) {
  const prevSame = [...state.frames].reverse().find((f) => f.idHex === partial.idHex);
  const changeMask = [];
  for (let i = 0; i < partial.data.length; i += 1) {
    changeMask.push(!prevSame || prevSame.data[i] !== partial.data[i]);
  }
  const decoded = decodeRacepakFrame(partial);
  const frame = {
    index: state.frames.length,
    ...partial,
    baseIdHex: decoded.baseIdHex,
    known: decoded.known,
    signals: decoded.signals,
    changed: !prevSame || changeMask.some(Boolean),
    changeMask,
    deltaMs: prevSame ? (partial.ts - prevSame.ts) * 1000 : null,
  };
  state.frames.push(frame);
  if (state.frames.length > 5000) {
    state.frames = state.frames.slice(-4000);
    state.frames.forEach((f, i) => {
      f.index = i;
    });
  }
  if (decoded.known) {
    for (const s of decoded.signals) {
      state.latestSignals[s.name] = {
        value: s.value,
        ts: frame.ts,
        idHex: frame.idHex,
      };
    }
  }
  if (followTail.checked) state.selectedIndex = frame.index;
  rebuildLiveCatalog();
  renderAll();
}

function handleBoardMessage(msg) {
  if (!msg || typeof msg !== "object") return;

  if (msg.t === "hello" && msg.board) {
    state.boardName = msg.board;
    wsStatus.textContent = `Live · ${msg.board}${msg.mode ? `/${msg.mode}` : ""}`;
  }
  if (msg.t === "board_status") {
    wsStatus.textContent = msg.connected
      ? `Hub · ${msg.boards} board(s)`
      : "Hub · waiting for /ws/board";
  }

  if (msg.t === "frame" && msg.id && msg.data) {
    const line = `(${msg.ts || Date.now() / 1000}) can0 ${msg.id}#${msg.data}`;
    const parsed = parseCandumpLine(line);
    if (parsed) pushLiveFrame(parsed);
    return;
  }

  if (msg.t === "signals" && msg.values) {
    // Represent pre-decoded board packets as synthetic inspectable rows
    const names = Object.keys(msg.values);
    const data = new Uint8Array(8);
    const frame = {
      ts: msg.ts || Date.now() / 1000,
      iface: "board",
      id: 0,
      idHex: (msg.board || state.boardName || "BOARD").toUpperCase().slice(0, 8),
      data,
      dataHex: "0000000000000000",
      dlc: 8,
    };
    // Attach signals manually
    const prevSame = [...state.frames].reverse().find((f) => f.idHex === frame.idHex);
    const entry = {
      index: state.frames.length,
      ...frame,
      baseIdHex: "BOARD",
      known: true,
      signals: names.map((name) => ({ name, value: msg.values[name], start: 0, len: 0 })),
      changed: true,
      changeMask: [true, true, true, true, true, true, true, true],
      deltaMs: prevSame ? (frame.ts - prevSame.ts) * 1000 : null,
    };
    for (const name of names) {
      state.latestSignals[name] = {
        value: msg.values[name],
        ts: frame.ts,
        idHex: frame.idHex,
      };
    }
    state.frames.push(entry);
    if (state.frames.length > 5000) state.frames = state.frames.slice(-4000);
    if (followTail.checked) state.selectedIndex = entry.index;
    rebuildLiveCatalog();
    renderAll();
  }

  if (msg.t === "signal" && msg.name != null) {
    handleBoardMessage({
      t: "signals",
      board: msg.board || state.boardName,
      values: { [msg.name]: msg.value },
      ts: msg.ts,
    });
  }
}

function setConnected(isConnected) {
  wsConnectBtn.disabled = isConnected;
  wsDisconnectBtn.disabled = !isConnected;
  wsUrlInput.disabled = isConnected;
}

function connectWs() {
  if (state.socket) state.socket.close();
  const url = wsUrlInput.value.trim();
  wsStatus.textContent = `Connecting ${url}`;
  state.socket = new WebSocket(url);
  state.socket.addEventListener("open", () => {
    setConnected(true);
    state.frames = [];
    state.catalog = [];
    state.latestSignals = {};
    state.selectedIndex = null;
    state.live = true;
    wsStatus.textContent = "Live · waiting for frames/signals";
    renderAll();
  });
  state.socket.addEventListener("message", (ev) => {
    try {
      handleBoardMessage(JSON.parse(ev.data));
    } catch {
      wsStatus.textContent = "Live · non-JSON message";
    }
  });
  state.socket.addEventListener("close", () => {
    setConnected(false);
    wsStatus.textContent = "Disconnected · file mode";
  });
  state.socket.addEventListener("error", () => {
    wsStatus.textContent = "WS error · check URL / Wi‑Fi";
  });
}

wsConnectBtn.addEventListener("click", connectWs);
wsDisconnectBtn.addEventListener("click", () => {
  if (state.socket) state.socket.close();
});

chartViewer = createLogChart({
  getState: () => state,
  onSeek: (index) => {
    followTail.checked = false;
    selectFrame(index);
    document.querySelector(".trace-panel")?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  },
});

loadSample(sampleSelect.value).catch(() => {
  wsStatus.textContent = "Load a candump to begin";
});
