const DEFINITION_COLUMNS = [
  "kind",
  "category",
  "name",
  "source",
  "address",
  "start",
  "shape",
  "endian",
  "signed",
  "scale",
  "offset",
  "unit",
  "axes",
  "notes",
];

const EXAMPLE_DEFINITIONS = [
  {
    kind: "signal",
    category: "Engine",
    name: "Engine Speed",
    source: "CAN",
    address: "1E001000",
    start: "B4",
    shape: "32",
    endian: "BE",
    signed: "yes",
    scale: "0.00390625",
    offset: "0",
    unit: "RPM",
    axes: "",
    notes: "Racepak base ID mask FFFFF800; verified from sample log",
  },
  {
    kind: "signal",
    category: "Electrical",
    name: "Battery Voltage",
    source: "CAN",
    address: "1E025000",
    start: "B4",
    shape: "32",
    endian: "BE",
    signed: "yes",
    scale: "0.00390625",
    offset: "0",
    unit: "V",
    axes: "",
    notes: "Example decoded field; not an OEM calibration address",
  },
  {
    kind: "pid",
    category: "Generic OBD2",
    name: "Engine RPM",
    source: "J1979",
    address: "Mode 01 PID 0C",
    start: "A,B",
    shape: "16",
    endian: "BE",
    signed: "no",
    scale: "0.25",
    offset: "0",
    unit: "RPM",
    axes: "request 7DF: 02 01 0C",
    notes: "Standard formula ((A*256)+B)/4",
  },
  {
    kind: "table",
    category: "Fuel",
    name: "Main Fuel / VE",
    source: "BIN",
    address: "strategy-specific",
    start: "",
    shape: "8x6",
    endian: "strategy",
    signed: "no",
    scale: "definition",
    offset: "definition",
    unit: "%",
    axes: "X=RPM; Y=load kPa",
    notes: "Workbook placeholder—requires matching strategy/OS definition",
  },
  {
    kind: "table",
    category: "Ignition",
    name: "Main Spark",
    source: "BIN",
    address: "strategy-specific",
    start: "",
    shape: "X×Y",
    endian: "strategy",
    signed: "yes",
    scale: "definition",
    offset: "definition",
    unit: "deg",
    axes: "X=RPM; Y=load",
    notes: "Common standalone/OEM category; no proprietary addresses included",
  },
  {
    kind: "table",
    category: "Boost",
    name: "Boost Target",
    source: "BIN",
    address: "strategy-specific",
    start: "",
    shape: "X×Y",
    endian: "strategy",
    signed: "no",
    scale: "definition",
    offset: "definition",
    unit: "kPa",
    axes: "X=RPM; Y=driver demand",
    notes: "Typical standalone table model",
  },
  {
    kind: "table",
    category: "Transmission",
    name: "Shift Schedule",
    source: "BIN",
    address: "strategy-specific",
    start: "",
    shape: "X×Y",
    endian: "strategy",
    signed: "no",
    scale: "definition",
    offset: "definition",
    unit: "mph",
    axes: "X=throttle; Y=gear",
    notes: "Example field category for a master workbook",
  },
  {
    kind: "routine",
    category: "Diagnostics",
    name: "Service Routine",
    source: "UDS",
    address: "SID 31",
    start: "",
    shape: "request",
    endian: "n/a",
    signed: "n/a",
    scale: "",
    offset: "",
    unit: "",
    axes: "session/security/OEM-specific",
    notes: "Do not execute until session, preconditions and routine ID are verified",
  },
];

const STORAGE_KEY = "autodash-definition-workbook-v1";
const SIM_STORAGE_KEY = "autodash-sim-table-v1";
const definitionBody = document.getElementById("definitionBody");
const definitionStatus = document.getElementById("definitionStatus");
let definitions = loadDefinitions();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function loadDefinitions() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(stored)) return stored;
  } catch {
    // Ignore invalid local data and restore the documented example.
  }
  return structuredClone(EXAMPLE_DEFINITIONS);
}

function saveDefinitions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(definitions));
  definitionStatus.textContent = `${definitions.length} fields · saved locally`;
}

function renderDefinitions() {
  definitionBody.innerHTML = definitions
    .map(
      (row, index) => `
        <tr data-row="${index}">
          <td><input class="row-select" type="checkbox" aria-label="Select row ${index + 1}" /></td>
          ${DEFINITION_COLUMNS.map(
            (column) =>
              `<td contenteditable="true" data-column="${column}">${escapeHtml(row[column])}</td>`
          ).join("")}
        </tr>`
    )
    .join("");
  saveDefinitions();
}

definitionBody.addEventListener("input", (event) => {
  const cell = event.target.closest("[data-column]");
  const row = event.target.closest("[data-row]");
  if (!cell || !row) return;
  definitions[Number(row.dataset.row)][cell.dataset.column] =
    cell.textContent.trim();
  saveDefinitions();
});

document.getElementById("definitionAdd").addEventListener("click", () => {
  definitions.push(
    Object.fromEntries(DEFINITION_COLUMNS.map((column) => [column, ""]))
  );
  renderDefinitions();
});

document.getElementById("definitionDelete").addEventListener("click", () => {
  const selected = new Set(
    [...definitionBody.querySelectorAll("tr")]
      .filter((row) => row.querySelector(".row-select")?.checked)
      .map((row) => Number(row.dataset.row))
  );
  definitions = definitions.filter((_, index) => !selected.has(index));
  renderDefinitions();
});

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, columns) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ].join("\r\n");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

const HEADER_ALIASES = {
  type: "kind",
  parameter: "name",
  field: "name",
  group: "category",
  id: "address",
  canid: "address",
  addressid: "address",
  byte: "start",
  bitstart: "start",
  length: "shape",
  bits: "shape",
  byteorder: "endian",
  factor: "scale",
  bias: "offset",
  units: "unit",
  description: "notes",
  formula: "notes",
};

function normalizeHeader(header) {
  const key = header.toLowerCase().replace(/[^a-z0-9]/g, "");
  return HEADER_ALIASES[key] || DEFINITION_COLUMNS.find(
    (column) => column.replace(/[^a-z0-9]/g, "") === key
  );
}

document.getElementById("definitionImport").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const parsed = parseCsv(await file.text());
  if (parsed.length < 2) return;
  const headers = parsed[0].map(normalizeHeader);
  const imported = parsed
    .slice(1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => {
      const item = Object.fromEntries(DEFINITION_COLUMNS.map((column) => [column, ""]));
      headers.forEach((header, index) => {
        if (header) item[header] = row[index] || "";
      });
      return item;
    });
  definitions = imported;
  renderDefinitions();
  definitionStatus.textContent = `${imported.length} fields imported from ${file.name}`;
  event.target.value = "";
});

function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

document.getElementById("definitionExport").addEventListener("click", () => {
  download(
    "autodash-definitions.csv",
    toCsv(definitions, DEFINITION_COLUMNS),
    "text/csv"
  );
});

document.getElementById("definitionReset").addEventListener("click", () => {
  definitions = structuredClone(EXAMPLE_DEFINITIONS);
  renderDefinitions();
});

// ---- Decode calculator ----------------------------------------------------

const calcInputs = ["calcHex", "calcType", "calcEndian", "calcScale", "calcOffset"]
  .map((id) => document.getElementById(id));

function calculate() {
  const clean = document
    .getElementById("calcHex")
    .value.replace(/0x|[^0-9a-f]/gi, "");
  const type = document.getElementById("calcType").value;
  const little = document.getElementById("calcEndian").value === "le";
  const byteLength = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4 }[type];
  const normalized = clean.padStart(byteLength * 2, "0").slice(-byteLength * 2);
  const bytes = Uint8Array.from(
    normalized.match(/../g) || [],
    (value) => parseInt(value, 16)
  );
  const view = new DataView(bytes.buffer);
  const readers = {
    u8: () => view.getUint8(0),
    i8: () => view.getInt8(0),
    u16: () => view.getUint16(0, little),
    i16: () => view.getInt16(0, little),
    u32: () => view.getUint32(0, little),
    i32: () => view.getInt32(0, little),
    f32: () => view.getFloat32(0, little),
  };
  const raw = readers[type]();
  const scale = Number(document.getElementById("calcScale").value);
  const offset = Number(document.getElementById("calcOffset").value);
  const engineering = raw * scale + offset;
  document.getElementById("calcRaw").textContent = Number.isFinite(raw)
    ? String(raw)
    : "invalid";
  document.getElementById("calcEngineering").textContent =
    Number.isFinite(engineering) ? engineering.toFixed(6) : "invalid";
  document.getElementById("calcBinary").textContent = [...bytes]
    .map((byte) => byte.toString(2).padStart(8, "0"))
    .join(" ");
}

calcInputs.forEach((input) => {
  input.addEventListener("input", calculate);
  input.addEventListener("change", calculate);
});

// ---- Calibration table simulator ----------------------------------------

const X_AXIS = [800, 1500, 2200, 3000, 3800, 4700, 5700, 7000];
const Y_AXIS = [20, 50, 80, 110, 150, 220];

function defaultTable() {
  return Y_AXIS.map((load, row) =>
    X_AXIS.map((rpm, column) =>
      Number(
        Math.max(
          30,
          Math.min(100, 42 + load * 0.19 + Math.sin(column / 2) * 7 - row * 0.7)
        ).toFixed(1)
      )
    )
  );
}

function loadTable() {
  try {
    const value = JSON.parse(localStorage.getItem(SIM_STORAGE_KEY));
    if (
      Array.isArray(value) &&
      value.length === Y_AXIS.length &&
      value.every((row) => Array.isArray(row) && row.length === X_AXIS.length)
    ) {
      return value;
    }
  } catch {
    // Fall back to the non-vehicle example.
  }
  return defaultTable();
}

let simValues = loadTable();
const simTable = document.getElementById("simTable");
const simCanvas = document.getElementById("simHeatmap");

function renderSimTable() {
  simTable.innerHTML = `
    <thead><tr><th>kPa \\ RPM</th>${X_AXIS.map((x) => `<th>${x}</th>`).join("")}</tr></thead>
    <tbody>
      ${Y_AXIS.map(
        (y, row) => `
          <tr>
            <th>${y}</th>
            ${simValues[row]
              .map(
                (value, column) =>
                  `<td contenteditable="true" data-sim-row="${row}" data-sim-column="${column}">${value}</td>`
              )
              .join("")}
          </tr>`
      ).join("")}
    </tbody>
  `;
}

function bracket(axis, value) {
  if (value <= axis[0]) return [0, 0, 0];
  if (value >= axis[axis.length - 1]) {
    const last = axis.length - 1;
    return [last, last, 0];
  }
  for (let i = 0; i < axis.length - 1; i += 1) {
    if (value >= axis[i] && value <= axis[i + 1]) {
      return [i, i + 1, (value - axis[i]) / (axis[i + 1] - axis[i])];
    }
  }
  return [0, 0, 0];
}

function interpolatedValue(rpm, load) {
  const [x0, x1, tx] = bracket(X_AXIS, rpm);
  const [y0, y1, ty] = bracket(Y_AXIS, load);
  const top = simValues[y0][x0] * (1 - tx) + simValues[y0][x1] * tx;
  const bottom = simValues[y1][x0] * (1 - tx) + simValues[y1][x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function drawHeatmap() {
  const rect = simCanvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  simCanvas.width = Math.round(rect.width * dpr);
  simCanvas.height = Math.round(rect.height * dpr);
  const ctx = simCanvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  const cellW = width / X_AXIS.length;
  const cellH = height / Y_AXIS.length;
  const values = simValues.flat();
  const min = Math.min(...values);
  const max = Math.max(...values);
  simValues.forEach((row, y) => {
    row.forEach((value, x) => {
      const ratio = (value - min) / Math.max(max - min, 1);
      const hue = 215 - ratio * 175;
      ctx.fillStyle = `hsl(${hue} 55% ${25 + ratio * 25}%)`;
      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
      ctx.strokeStyle = "#0f1412";
      ctx.strokeRect(x * cellW, y * cellH, cellW, cellH);
      ctx.fillStyle = "#e7eee9";
      ctx.font = "11px IBM Plex Mono";
      ctx.fillText(value.toFixed(1), x * cellW + 4, y * cellH + 15);
    });
  });

  const rpm = Number(document.getElementById("simRpm").value);
  const load = Number(document.getElementById("simLoad").value);
  const px =
    ((rpm - X_AXIS[0]) / (X_AXIS[X_AXIS.length - 1] - X_AXIS[0])) *
    (width - cellW) +
    cellW / 2;
  const py =
    ((load - Y_AXIS[0]) / (Y_AXIS[Y_AXIS.length - 1] - Y_AXIS[0])) *
    (height - cellH) +
    cellH / 2;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.strokeRect(px - 6, py - 6, 12, 12);
}

function updateSimulation() {
  const rpm = Number(document.getElementById("simRpm").value);
  const load = Number(document.getElementById("simLoad").value);
  document.getElementById("simRpmLabel").value = rpm;
  document.getElementById("simLoadLabel").value = load;
  document.getElementById("simValue").textContent =
    interpolatedValue(rpm, load).toFixed(2);
  drawHeatmap();
}

simTable.addEventListener("input", (event) => {
  const cell = event.target.closest("[data-sim-row]");
  if (!cell) return;
  const value = Number(cell.textContent);
  if (!Number.isFinite(value)) return;
  simValues[Number(cell.dataset.simRow)][Number(cell.dataset.simColumn)] = value;
  localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(simValues));
  updateSimulation();
});

["simRpm", "simLoad"].forEach((id) =>
  document.getElementById(id).addEventListener("input", updateSimulation)
);

document.getElementById("simExport").addEventListener("click", () => {
  const rows = Y_AXIS.map((load, row) => {
    const item = { load_kpa: load };
    X_AXIS.forEach((rpm, column) => {
      item[`rpm_${rpm}`] = simValues[row][column];
    });
    return item;
  });
  download(
    "example-calibration-table.csv",
    toCsv(rows, ["load_kpa", ...X_AXIS.map((rpm) => `rpm_${rpm}`)]),
    "text/csv"
  );
});

document.getElementById("definitionJson").addEventListener("click", () => {
  download(
    "autodash-research-project.json",
    JSON.stringify(
      {
        schema: "autodash.research.v1",
        warning:
          "Research definitions only. Verify ECU strategy, checksums, security and recovery before writing.",
        definitions,
        simulator: {
          name: "Example VE-like table",
          xAxis: { name: "RPM", values: X_AXIS },
          yAxis: { name: "Load", unit: "kPa", values: Y_AXIS },
          values: simValues,
        },
      },
      null,
      2
    ),
    "application/json"
  );
});

renderDefinitions();
calculate();
renderSimTable();
updateSimulation();
new ResizeObserver(drawHeatmap).observe(simCanvas);
