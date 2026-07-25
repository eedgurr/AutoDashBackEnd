const PAGE_SIZE = 256;
const BYTES_PER_ROW = 16;

const state = {
  original: null,
  data: null,
  binName: "",
  pageOffset: 0,
  selectedOffset: null,
  edits: new Map(),
  searchOffset: null,
  xdfName: "",
  xdfMeta: null,
  xdfItems: [],
  selectedItem: null,
};

const binaryStatus = document.getElementById("binaryStatus");
const xdfMeta = document.getElementById("xdfMeta");
const xdfItems = document.getElementById("xdfItems");
const xdfFilter = document.getElementById("xdfFilter");
const hexViewer = document.getElementById("hexViewer");
const hexPage = document.getElementById("hexPage");
const binExport = document.getElementById("binExport");
const binUndo = document.getElementById("binUndo");
const byteApply = document.getElementById("byteApply");
const xdfCanvas = document.getElementById("xdfHeatmap");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function hex(value, width = 2) {
  return Number(value).toString(16).toUpperCase().padStart(width, "0");
}

function parseNumber(value, fallback = 0) {
  if (value == null || value === "") return fallback;
  const text = String(value).trim();
  const parsed = /^-?0x/i.test(text)
    ? Number.parseInt(text, 16)
    : Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function updateStatus(extra = "") {
  const bin = state.data
    ? `${state.binName}: ${state.data.length.toLocaleString()} bytes`
    : "no BIN";
  const xdf = state.xdfMeta
    ? `${state.xdfName}: ${state.xdfItems.length} items`
    : "no XDF";
  binaryStatus.textContent = `${bin} · ${xdf}${extra ? ` · ${extra}` : ""}`;
}

function download(name, bytes, type = "application/octet-stream") {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function selectByte(offset) {
  if (!state.data || offset < 0 || offset >= state.data.length) return;
  state.selectedOffset = offset;
  document.getElementById("byteOffset").textContent = `0x${hex(offset, 8)}`;
  document.getElementById("byteOriginal").textContent = hex(
    state.original[offset]
  );
  document.getElementById("byteCurrent").textContent = hex(state.data[offset]);
  document.getElementById("byteEdit").value = hex(state.data[offset]);
  byteApply.disabled = false;
  renderHex();
}

function highlightedRange() {
  if (!state.selectedItem) return null;
  return [
    state.selectedItem.address,
    state.selectedItem.address + Math.max(1, state.selectedItem.byteLength),
  ];
}

function renderHex() {
  if (!state.data) {
    hexViewer.innerHTML =
      '<p class="muted">Load a BIN/ROM file. Files stay in this browser.</p>';
    hexPage.textContent = "No data";
    return;
  }
  const start = Math.min(
    Math.max(0, state.pageOffset),
    Math.max(0, state.data.length - 1)
  );
  const end = Math.min(state.data.length, start + PAGE_SIZE);
  const range = highlightedRange();
  const rows = [];
  for (let offset = start; offset < end; offset += BYTES_PER_ROW) {
    const bytes = [];
    const ascii = [];
    for (let column = 0; column < BYTES_PER_ROW; column += 1) {
      const index = offset + column;
      if (index >= state.data.length) {
        bytes.push('<span class="hex-byte empty">  </span>');
        ascii.push(" ");
        continue;
      }
      const value = state.data[index];
      const classes = ["hex-byte"];
      if (state.edits.has(index)) classes.push("edited");
      if (state.selectedOffset === index) classes.push("selected");
      if (state.searchOffset === index) classes.push("search-hit");
      if (range && index >= range[0] && index < range[1]) {
        classes.push("xdf-range");
      }
      bytes.push(
        `<button type="button" class="${classes.join(" ")}" data-offset="${index}">${hex(value)}</button>`
      );
      ascii.push(value >= 32 && value <= 126 ? String.fromCharCode(value) : ".");
    }
    rows.push(`
      <div class="hex-row">
        <button class="hex-offset" type="button" data-offset="${offset}">${hex(offset, 8)}</button>
        <div class="hex-bytes">${bytes.join("")}</div>
        <div class="hex-ascii">${escapeHtml(ascii.join(""))}</div>
      </div>
    `);
  }
  hexViewer.innerHTML = rows.join("");
  hexPage.textContent = `0x${hex(start, 8)}–0x${hex(end - 1, 8)} / 0x${hex(
    state.data.length - 1,
    8
  )}`;
}

function goToOffset(offset, select = true) {
  if (!state.data) return;
  const safe = Math.min(Math.max(0, offset), state.data.length - 1);
  state.pageOffset = Math.floor(safe / PAGE_SIZE) * PAGE_SIZE;
  if (select) state.selectedOffset = safe;
  renderHex();
  if (select) selectByte(safe);
}

hexViewer.addEventListener("click", (event) => {
  const target = event.target.closest("[data-offset]");
  if (!target) return;
  selectByte(Number(target.dataset.offset));
});

document.getElementById("hexPrev").addEventListener("click", () => {
  goToOffset(state.pageOffset - PAGE_SIZE, false);
});
document.getElementById("hexNext").addEventListener("click", () => {
  goToOffset(state.pageOffset + PAGE_SIZE, false);
});
document.getElementById("hexJumpButton").addEventListener("click", () => {
  goToOffset(parseNumber(document.getElementById("hexJump").value));
});
document.getElementById("hexJump").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    goToOffset(parseNumber(event.currentTarget.value));
  }
});

function searchBytes(input) {
  const trimmed = input.trim();
  if (!trimmed || !state.data) return -1;
  const compact = trimmed.replace(/0x|[\s,_-]/gi, "");
  let needle;
  if (/^[0-9a-f]+$/i.test(compact) && compact.length % 2 === 0) {
    needle = Uint8Array.from(compact.match(/../g), (part) =>
      Number.parseInt(part, 16)
    );
  } else {
    needle = new TextEncoder().encode(trimmed);
  }
  const start = Math.max(0, (state.searchOffset ?? -1) + 1);
  for (let i = start; i <= state.data.length - needle.length; i += 1) {
    let match = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (state.data[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

document.getElementById("hexSearchButton").addEventListener("click", () => {
  const found = searchBytes(document.getElementById("hexSearch").value);
  if (found >= 0) {
    state.searchOffset = found;
    goToOffset(found);
    updateStatus(`match at 0x${hex(found, 8)}`);
  } else {
    state.searchOffset = null;
    updateStatus("no further match");
  }
});

byteApply.addEventListener("click", () => {
  if (state.selectedOffset == null || !state.data) return;
  const text = document.getElementById("byteEdit").value.trim();
  if (!/^[0-9a-f]{2}$/i.test(text)) {
    updateStatus("byte edit must be exactly two hex characters");
    return;
  }
  const value = Number.parseInt(text, 16);
  state.data[state.selectedOffset] = value;
  if (value === state.original[state.selectedOffset]) {
    state.edits.delete(state.selectedOffset);
  } else {
    state.edits.set(state.selectedOffset, value);
  }
  binUndo.disabled = state.edits.size === 0;
  document.getElementById("byteCurrent").textContent = hex(value);
  renderHex();
  renderXdfPreview();
  updateStatus(`${state.edits.size} staged byte edit(s)`);
});

binUndo.addEventListener("click", () => {
  if (!state.original) return;
  state.data = state.original.slice();
  state.edits.clear();
  binUndo.disabled = true;
  renderHex();
  renderXdfPreview();
  if (state.selectedOffset != null) selectByte(state.selectedOffset);
  updateStatus("edits reverted");
});

binExport.addEventListener("click", () => {
  if (!state.data) return;
  const dot = state.binName.lastIndexOf(".");
  const name =
    dot >= 0
      ? `${state.binName.slice(0, dot)}-modified${state.binName.slice(dot)}`
      : `${state.binName}-modified.bin`;
  download(name, state.data);
});

function scanVins() {
  const results = document.getElementById("vinResults");
  if (!state.data) {
    results.innerHTML = '<p class="muted">No BIN loaded</p>';
    return;
  }
  const chars = [...state.data]
    .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : " "))
    .join("");
  const vinPattern = /[A-HJ-NPR-Z0-9]{17}/g;
  const matches = [];
  let match;
  while ((match = vinPattern.exec(chars)) && matches.length < 50) {
    matches.push({ value: match[0], offset: match.index });
  }
  results.innerHTML = matches.length
    ? matches
        .map(
          (item) => `
            <button class="vin-result" type="button" data-offset="${item.offset}">
              <strong>${item.value}</strong><span>0x${hex(item.offset, 8)}</span>
            </button>`
        )
        .join("")
    : '<p class="muted">No VIN-like ASCII strings found.</p>';
}

document.getElementById("vinResults").addEventListener("click", (event) => {
  const target = event.target.closest("[data-offset]");
  if (target) goToOffset(Number(target.dataset.offset));
});

function loadBinary(bytes, name) {
  state.original = new Uint8Array(bytes);
  state.data = state.original.slice();
  state.binName = name;
  state.pageOffset = 0;
  state.selectedOffset = null;
  state.edits.clear();
  state.searchOffset = null;
  binExport.disabled = false;
  binUndo.disabled = true;
  scanVins();
  renderHex();
  renderXdfPreview();
  updateStatus();
}

function extensionOf(name = "") {
  const match = /\.([^.]+)$/.exec(name);
  return match ? match[1].toLowerCase() : "";
}

function looksLikeXdfText(text) {
  const head = text.slice(0, 4000);
  return /<XDFFORMAT[\s>]/i.test(head) || /<XDFHEADER[\s>]/i.test(head);
}

async function openBinaryFile(file) {
  if (!file) return;
  try {
    loadBinary(await file.arrayBuffer(), file.name || "binary.bin");
    updateStatus(`loaded ${file.name || "binary.bin"}`);
  } catch (error) {
    updateStatus(`BIN open failed: ${error.message}`);
  }
}

async function openXdfFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    if (!looksLikeXdfText(text)) {
      updateStatus(
        `${file.name} does not look like an XDF/XML definition. Try Open any file or Load synthetic demo.`
      );
      return;
    }
    loadXdf(text, file.name || "definition.xdf");
    updateStatus(`loaded ${file.name || "definition.xdf"}`);
  } catch (error) {
    updateStatus(`XDF open failed: ${error.message}`);
  }
}

async function openAnyFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  for (const file of files) {
    const extension = extensionOf(file.name);
    if (["xdf", "xtf", "xml"].includes(extension)) {
      await openXdfFile(file);
      continue;
    }
    if (["bin", "rom", "ori", "hex", "ecu", "mod"].includes(extension)) {
      await openBinaryFile(file);
      continue;
    }
    // Unknown extension: sniff content (common on iOS Files).
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder("utf-8", { fatal: false }).decode(
      buffer.slice(0, Math.min(buffer.byteLength, 4000))
    );
    if (looksLikeXdfText(text)) {
      loadXdf(new TextDecoder().decode(buffer), file.name || "definition.xdf");
      updateStatus(`auto-detected XDF: ${file.name}`);
    } else {
      loadBinary(buffer, file.name || "binary.bin");
      updateStatus(`auto-detected BIN: ${file.name}`);
    }
  }
}

document.getElementById("binFile").addEventListener("change", async (event) => {
  await openBinaryFile(event.target.files?.[0]);
  event.target.value = "";
});

document.getElementById("anyBinaryFile").addEventListener("change", async (event) => {
  await openAnyFiles(event.target.files);
  event.target.value = "";
});

// ---- XDF parsing ----------------------------------------------------------

function childText(element, name) {
  return element?.querySelector(`:scope > ${name}`)?.textContent?.trim() || "";
}

function embeddedForItem(element) {
  if (element.tagName !== "XDFTABLE") {
    return element.querySelector(":scope > EMBEDDEDDATA");
  }
  const z = [...element.querySelectorAll(":scope > XDFAXIS")].find(
    (axis) => axis.getAttribute("id") === "z"
  );
  const x = [...element.querySelectorAll(":scope > XDFAXIS")].find(
    (axis) => axis.getAttribute("id") === "x"
  );
  const zData = z?.querySelector(":scope > EMBEDDEDDATA");
  const xData = x?.querySelector(":scope > EMBEDDEDDATA");
  if (zData?.hasAttribute("mmedaddress")) return zData;
  if (xData?.hasAttribute("mmedaddress")) return xData;
  return zData || xData || element.querySelector("EMBEDDEDDATA");
}

function parseXdf(text, name) {
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const parseError = xml.querySelector("parsererror");
  if (parseError) throw new Error("Invalid XDF/XML");
  const root = xml.documentElement;
  if (root.tagName !== "XDFFORMAT") throw new Error("Not an XDFFORMAT document");
  const header = root.querySelector(":scope > XDFHEADER");
  const baseElement = header?.querySelector(":scope > BASEOFFSET");
  const baseOffset = parseNumber(baseElement?.getAttribute("offset"), 0);
  const subtract = parseNumber(baseElement?.getAttribute("subtract"), 0) !== 0;
  const defaults = header?.querySelector(":scope > DEFAULTS");
  const defaultBits = parseNumber(defaults?.getAttribute("datasizeinbits"), 8);
  const defaultLittle = parseNumber(defaults?.getAttribute("lsbfirst"), 0) !== 0;
  const defaultSigned = parseNumber(defaults?.getAttribute("signed"), 0) !== 0;
  const categories = new Map(
    [...root.querySelectorAll(":scope > XDFCATEGORY")].map((category) => [
      category.getAttribute("index"),
      category.getAttribute("name") || "",
    ])
  );
  const items = [];

  for (const element of root.querySelectorAll(
    ":scope > XDFCONSTANT, :scope > XDFFLAG, :scope > XDFTABLE, :scope > XDFPATCH"
  )) {
    const embedded = embeddedForItem(element);
    const rawAddress = parseNumber(embedded?.getAttribute("mmedaddress"), 0);
    const address = subtract
      ? rawAddress - baseOffset
      : rawAddress + baseOffset;
    const zAxis = [...element.querySelectorAll(":scope > XDFAXIS")].find(
      (axis) => axis.getAttribute("id") === "z"
    );
    const zData = zAxis?.querySelector(":scope > EMBEDDEDDATA");
    const bits = parseNumber(
      zData?.getAttribute("mmedelementsizebits") ||
        embedded?.getAttribute("mmedelementsizebits"),
      defaultBits
    );
    const rows = parseNumber(zData?.getAttribute("mmedrowcount"), 1);
    const columns = parseNumber(zData?.getAttribute("mmedcolcount"), 1);
    const math = zAxis?.querySelector(":scope > MATH") ||
      element.querySelector(":scope > MATH");
    const categoryIndexes = [
      ...element.querySelectorAll(":scope > CATEGORYMEM"),
    ].map((entry) => entry.getAttribute("category"));
    const category = categoryIndexes
      .map((index) => categories.get(index))
      .filter(Boolean)
      .join(" / ");
    const byteLength = Math.ceil((bits * rows * columns) / 8);
    items.push({
      kind: element.tagName.replace("XDF", "").toLowerCase(),
      title: childText(element, "title") || element.getAttribute("uniqueid") || "Untitled",
      description: childText(element, "description"),
      category,
      uniqueId: element.getAttribute("uniqueid") || "",
      address,
      rawAddress,
      bits,
      rows,
      columns,
      byteLength,
      equation: math?.getAttribute("equation") || "X",
      units: childText(zAxis, "units") || childText(element, "units"),
      littleEndian: defaultLittle,
      signed: defaultSigned,
    });
  }

  return {
    meta: {
      name,
      version: root.getAttribute("version") || "",
      title: childText(header, "deftitle") || name,
      author: childText(header, "author"),
      baseOffset,
      subtract,
    },
    items,
  };
}

function renderXdfItems() {
  if (!state.xdfMeta) {
    xdfMeta.textContent = "No XDF loaded";
    xdfItems.innerHTML = "";
    return;
  }
  const filter = xdfFilter.value.trim().toLowerCase();
  const items = state.xdfItems.filter((item) =>
    `${item.title} ${item.category} ${item.kind}`.toLowerCase().includes(filter)
  );
  xdfMeta.textContent = `${state.xdfMeta.title} · XDF ${state.xdfMeta.version} · ${items.length}/${state.xdfItems.length} items`;
  xdfItems.innerHTML = items
    .map(
      (item, index) => `
        <button class="xdf-item ${
          state.selectedItem === item ? "selected" : ""
        }" type="button" data-xdf-index="${state.xdfItems.indexOf(item)}">
          <span class="xdf-kind">${escapeHtml(item.kind)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.category || "Uncategorized")}</span>
          <code>0x${hex(item.address, 8)} · ${item.bits}-bit${
            item.rows * item.columns > 1 ? ` · ${item.columns}×${item.rows}` : ""
          }</code>
        </button>
      `
    )
    .join("");
}

function loadXdf(text, name) {
  try {
    const parsed = parseXdf(text, name);
    state.xdfName = name;
    state.xdfMeta = parsed.meta;
    state.xdfItems = parsed.items;
    state.selectedItem = null;
    renderXdfItems();
    renderXdfPreview();
    updateStatus();
  } catch (error) {
    updateStatus(error.message);
  }
}

document.getElementById("xdfFile").addEventListener("change", async (event) => {
  await openXdfFile(event.target.files?.[0]);
  event.target.value = "";
});

xdfFilter.addEventListener("input", renderXdfItems);
xdfItems.addEventListener("click", (event) => {
  const target = event.target.closest("[data-xdf-index]");
  if (!target) return;
  state.selectedItem = state.xdfItems[Number(target.dataset.xdfIndex)];
  renderXdfItems();
  renderXdfPreview();
  if (state.data) goToOffset(state.selectedItem.address);
});

function readRaw(offset, bits, littleEndian, signed) {
  if (!state.data) return null;
  const bytes = Math.ceil(bits / 8);
  if (offset < 0 || offset + bytes > state.data.length) return null;
  const view = new DataView(
    state.data.buffer,
    state.data.byteOffset,
    state.data.byteLength
  );
  if (bits === 8) return signed ? view.getInt8(offset) : view.getUint8(offset);
  if (bits === 16) {
    return signed
      ? view.getInt16(offset, littleEndian)
      : view.getUint16(offset, littleEndian);
  }
  if (bits === 32) {
    return signed
      ? view.getInt32(offset, littleEndian)
      : view.getUint32(offset, littleEndian);
  }
  return state.data[offset];
}

function applySimpleEquation(equation, raw) {
  if (!/^[\dXx+\-*/().\s]+$/.test(equation)) return raw;
  try {
    // XDF equations can be richer; this preview intentionally evaluates only
    // arithmetic containing X and numeric operators.
    const expression = equation.replace(/\bX\b/gi, `(${Number(raw)})`);
    const value = Function(`"use strict"; return (${expression});`)();
    return Number.isFinite(value) ? value : raw;
  } catch {
    return raw;
  }
}

function tableValues(item) {
  if (!state.data || !item) return [];
  const count = Math.max(1, item.rows * item.columns);
  const stride = Math.max(1, Math.ceil(item.bits / 8));
  const applyMath = document.getElementById("xdfApplyMath").checked;
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const raw = readRaw(
      item.address + index * stride,
      item.bits,
      item.littleEndian,
      item.signed
    );
    values.push(
      raw == null
        ? null
        : applyMath
          ? applySimpleEquation(item.equation, raw)
          : raw
    );
  }
  return values;
}

function drawXdfHeatmap(values, item) {
  const rect = xdfCanvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  xdfCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  xdfCanvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = xdfCanvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  if (!values.length || !item) return;
  const numeric = values.filter(Number.isFinite);
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const rows = Math.max(1, item.rows);
  const columns = Math.max(1, item.columns);
  const width = rect.width / columns;
  const height = rect.height / rows;
  values.forEach((value, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const ratio = Number.isFinite(value)
      ? (value - min) / Math.max(max - min, 1)
      : 0;
    ctx.fillStyle = `hsl(${215 - ratio * 175} 55% ${22 + ratio * 28}%)`;
    ctx.fillRect(column * width, row * height, width, height);
    ctx.strokeStyle = "#0f1412";
    ctx.strokeRect(column * width, row * height, width, height);
    if (width >= 34 && height >= 20 && Number.isFinite(value)) {
      ctx.fillStyle = "#e7eee9";
      ctx.font = "10px IBM Plex Mono";
      ctx.fillText(
        Number(value).toFixed(1),
        column * width + 3,
        row * height + 13
      );
    }
  });
}

function renderXdfPreview() {
  const item = state.selectedItem;
  const title = document.getElementById("xdfPreviewTitle");
  const meta = document.getElementById("xdfPreviewMeta");
  const table = document.getElementById("xdfRawTable");
  if (!item) {
    title.textContent = "XDF item preview";
    meta.textContent = "Select an XDF item to jump into the binary.";
    table.innerHTML = '<p class="muted">No item selected</p>';
    drawXdfHeatmap([], null);
    renderHex();
    return;
  }
  title.textContent = item.title;
  meta.textContent = `${item.kind} · 0x${hex(item.address, 8)} · ${
    item.bits
  }-bit · equation ${item.equation}${
    item.units ? ` · ${item.units}` : ""
  }`;
  const values = tableValues(item);
  if (!state.data) {
    table.innerHTML =
      '<p class="muted">XDF loaded. Load the matching BIN to read values.</p>';
    drawXdfHeatmap([], item);
    renderHex();
    return;
  }
  const columns = Math.max(1, item.columns);
  const rows = Math.max(1, item.rows);
  table.innerHTML = `
    <table>
      <thead><tr><th>row</th>${Array.from(
        { length: columns },
        (_, column) => `<th>${column}</th>`
      ).join("")}</tr></thead>
      <tbody>
        ${Array.from(
          { length: rows },
          (_, row) => `
            <tr>
              <th>${row}</th>
              ${Array.from({ length: columns }, (_, column) => {
                const value = values[row * columns + column];
                return `<td>${Number.isFinite(value) ? Number(value).toFixed(3) : "—"}</td>`;
              }).join("")}
            </tr>`
        ).join("")}
      </tbody>
    </table>
  `;
  drawXdfHeatmap(values, item);
  renderHex();
}

document
  .getElementById("xdfApplyMath")
  .addEventListener("change", renderXdfPreview);
new ResizeObserver(() => renderXdfPreview()).observe(xdfCanvas);

// ---- Synthetic, openly generated demonstration ---------------------------

const DEMO_XDF = `<?xml version="1.0" encoding="utf-8"?>
<XDFFORMAT version="1.80">
  <XDFHEADER>
    <deftitle>AutoDash Synthetic ECU</deftitle>
    <author>AutoDash demo</author>
    <BASEOFFSET offset="0" subtract="0" />
    <DEFAULTS datasizeinbits="8" signed="0" lsbfirst="0" />
  </XDFHEADER>
  <XDFCATEGORY index="0x1" name="Fuel" />
  <XDFCATEGORY index="0x2" name="Limits" />
  <XDFCONSTANT uniqueid="0x100">
    <title>RPM Limit</title>
    <CATEGORYMEM category="0x2" />
    <EMBEDDEDDATA mmedaddress="0x0800" mmedelementsizebits="16" />
    <units>RPM</units>
    <MATH equation="X" />
  </XDFCONSTANT>
  <XDFTABLE uniqueid="0x200">
    <title>Example VE Table</title>
    <description>Synthetic values; not from a vehicle</description>
    <CATEGORYMEM category="0x1" />
    <XDFAXIS id="x"><EMBEDDEDDATA mmedaddress="0x1000" mmedelementsizebits="8" /></XDFAXIS>
    <XDFAXIS id="y"><units>load</units><indexcount>6</indexcount></XDFAXIS>
    <XDFAXIS id="z">
      <EMBEDDEDDATA mmedelementsizebits="8" mmedrowcount="6" mmedcolcount="8" />
      <units>%</units>
      <MATH equation="X" />
    </XDFAXIS>
  </XDFTABLE>
</XDFFORMAT>`;

function buildSyntheticBinary() {
  const bytes = new Uint8Array(0x1200);
  bytes.fill(0xff);
  const vin = new TextEncoder().encode("1AUT0DASH0DEM0001");
  bytes.set(vin, 0x0200);
  bytes[0x0800] = 0x1b;
  bytes[0x0801] = 0x58; // 7000 RPM, big endian
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bytes[0x1000 + row * 8 + column] =
        45 + row * 7 + Math.round(Math.sin(column / 2) * 8);
    }
  }
  return bytes;
}

function loadSyntheticDemo(note = "synthetic demo—not vehicle data") {
  loadBinary(buildSyntheticBinary(), "synthetic-demo.bin");
  loadXdf(DEMO_XDF, "synthetic-demo.xdf");
  const firstTable = state.xdfItems.find((item) => item.kind === "table");
  if (firstTable) {
    state.selectedItem = firstTable;
    renderXdfItems();
    renderXdfPreview();
    goToOffset(firstTable.address);
  }
  updateStatus(note);
}

document.getElementById("binaryDemo").addEventListener("click", () => {
  loadSyntheticDemo();
});

document
  .getElementById("binarySampleFetch")
  .addEventListener("click", async () => {
    try {
      const [binResponse, xdfResponse] = await Promise.all([
        fetch("./samples/synthetic-demo.bin", { cache: "no-store" }),
        fetch("./samples/synthetic-demo.xdf", { cache: "no-store" }),
      ]);
      if (!binResponse.ok || !xdfResponse.ok) {
        throw new Error("sample fetch failed");
      }
      loadBinary(await binResponse.arrayBuffer(), "synthetic-demo.bin");
      loadXdf(await xdfResponse.text(), "synthetic-demo.xdf");
      const firstTable = state.xdfItems.find((item) => item.kind === "table");
      if (firstTable) {
        state.selectedItem = firstTable;
        renderXdfItems();
        renderXdfPreview();
        goToOffset(firstTable.address);
      }
      updateStatus("fetched sample BIN+XDF from server");
    } catch (error) {
      updateStatus(`sample fetch failed: ${error.message}`);
      loadSyntheticDemo("offline fallback synthetic demo");
    }
  });

renderXdfItems();
renderHex();
renderXdfPreview();
updateStatus();

// Phone-first: show a working viewer immediately so the page is never an empty gray shell.
const params = new URLSearchParams(location.search);
if (params.get("demo") !== "0") {
  loadSyntheticDemo("auto-loaded synthetic demo · use openers above for your files");
}
