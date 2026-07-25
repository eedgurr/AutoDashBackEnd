import {
  decodeCandumpText,
  formatSignal,
  SIGNAL_META,
} from "./decoder.js";

const sampleSelect = document.getElementById("sampleSelect");
const fileInput = document.getElementById("fileInput");
const includeUnknown = document.getElementById("includeUnknown");
const statsEl = document.getElementById("stats");
const gaugesEl = document.getElementById("gauges");
const eventsBody = document.getElementById("eventsBody");
const eventsMeta = document.getElementById("eventsMeta");

let currentText = "";

async function loadSample(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  currentText = await res.text();
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
    ["Duration", `${summary.durationSec.toFixed(2)}s`],
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
    if (entry.value < range[0] || entry.value > range[1]) bad += 1;
  }
  return seen > 0 && bad / seen >= 0.5;
}

function renderGauges(latest) {
  const names = Object.keys(SIGNAL_META);
  const warn = looksLikeWrongProtocol(latest)
    ? `<p class="protocol-warn">Many values are out of range — this dump may not be Racepak scaling (common with some Holley captures). IDs match, encoding may differ.</p>`
    : "";
  const cards = names
    .map((name) => {
      const entry = latest[name];
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
            <td>${ev.ts.toFixed(3)}</td>
            <td>${ev.idHex}</td>
            <td class="unknown">unknown base ${ev.baseIdHex}</td>
          </tr>`;
      }
      const chips = ev.signals
        .map((s) => {
          const f = formatSignal(s.name, s.value);
          return `<span class="signal-chip">${s.name} ${f.text}${f.unit ? " " + f.unit : ""}</span>`;
        })
        .join("");
      return `
        <tr>
          <td>${ev.ts.toFixed(3)}</td>
          <td>${ev.idHex}</td>
          <td>${chips}</td>
        </tr>`;
    })
    .join("");
  eventsBody.innerHTML = rows || `<tr><td colspan="3">No decoded events</td></tr>`;
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
  render();
});

includeUnknown.addEventListener("change", () => {
  if (currentText) render();
});

// Auto-load racepak running sample for a one-tap phone demo
loadSample("./samples/racepak-running-sample.log").catch(() => {
  eventsMeta.textContent = "Pick a sample or upload a candump log.";
});
