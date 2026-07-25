/**
 * Browser-safe Racepak candump analyzer + decoder.
 * Trace-first helpers for OEM-style CAN reverse engineering.
 */

export const SIGNAL_META = {
  RPM: { unit: "RPM", decimals: 0 },
  FUEL_FLOW: { unit: "lb/h", decimals: 1 },
  PEDAL_POSITION: { unit: "%", decimals: 1 },
  TARGET_AFR: { unit: "A/F", decimals: 2 },
  IGNITION_TIMING: { unit: "deg", decimals: 1 },
  AFR_AVERAGE: { unit: "A/F", decimals: 2 },
  MAP: { unit: "kPa", decimals: 1 },
  MAT: { unit: "°F", decimals: 1 },
  BAR_PRESSURE: { unit: "kPa", decimals: 1 },
  CTS: { unit: "°F", decimals: 1 },
  OIL_PRESSURE: { unit: "psi", decimals: 1 },
  BATT_VOLTAGE: { unit: "V", decimals: 2 },
};

/** Racepak base ID mask used by AutoDashBackEnd */
export const ID_MASK = 0xfffff800;

function readInt32BE(bytes, offset) {
  if (offset + 4 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt32(offset, false);
}

function readInt32LE(bytes, offset) {
  if (offset + 4 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt32(offset, true);
}

function readInt16BE(bytes, offset) {
  if (offset + 2 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt16(offset, false);
}

function readInt16LE(bytes, offset) {
  if (offset + 2 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt16(offset, true);
}

function readFloat32BE(bytes, offset) {
  if (offset + 4 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getFloat32(offset, false);
}

function scaledBE(bytes, offset) {
  const v = readInt32BE(bytes, offset);
  return v == null ? null : v / 256;
}

const RACEPAK_MAP = {
  0x1e001000: (data) => [{ name: "RPM", value: scaledBE(data, 4), start: 4, len: 4 }],
  0x1e005000: (data) => [{ name: "FUEL_FLOW", value: scaledBE(data, 4), start: 4, len: 4 }],
  0x1e029000: (data) => [{ name: "PEDAL_POSITION", value: scaledBE(data, 0), start: 0, len: 4 }],
  0x1e011000: (data) => [{ name: "TARGET_AFR", value: scaledBE(data, 0), start: 0, len: 4 }],
  0x1e015000: (data) => [
    { name: "IGNITION_TIMING", value: scaledBE(data, 0), start: 0, len: 4 },
    { name: "AFR_AVERAGE", value: scaledBE(data, 4), start: 4, len: 4 },
  ],
  0x1e019000: (data) => [{ name: "MAP", value: scaledBE(data, 0), start: 0, len: 4 }],
  0x1e01d000: (data) => [{ name: "MAT", value: scaledBE(data, 0), start: 0, len: 4 }],
  0x1e021000: (data) => [
    { name: "BAR_PRESSURE", value: scaledBE(data, 0), start: 0, len: 4 },
    { name: "CTS", value: scaledBE(data, 4), start: 4, len: 4 },
  ],
  0x1e025000: (data) => [
    { name: "OIL_PRESSURE", value: scaledBE(data, 0), start: 0, len: 4 },
    { name: "BATT_VOLTAGE", value: scaledBE(data, 4), start: 4, len: 4 },
  ],
};

export function parseCandumpLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const match = trimmed.match(
    /^\((\d+(?:\.\d+)?)\)\s+(\S+)\s+([0-9A-Fa-f]+)#([0-9A-Fa-f]*)$/
  );
  if (!match) return null;

  const [, ts, iface, idHex, dataHex] = match;
  const bytes = new Uint8Array(dataHex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16);
  }

  return {
    ts: Number(ts),
    iface,
    id: parseInt(idHex, 16),
    idHex: idHex.toUpperCase(),
    data: bytes,
    dataHex: dataHex.toUpperCase(),
    dlc: bytes.length,
  };
}

export function decodeRacepakFrame(frame) {
  const baseId = frame.id & ID_MASK;
  const handler = RACEPAK_MAP[baseId];
  if (!handler) {
    return {
      baseId,
      baseIdHex: baseId.toString(16).toUpperCase().padStart(8, "0"),
      signals: [],
      known: false,
    };
  }
  return {
    baseId,
    baseIdHex: baseId.toString(16).toUpperCase().padStart(8, "0"),
    signals: handler(frame.data).filter((s) => s.value != null),
    known: true,
  };
}

/** Guess common OEM encodings for a payload (RE helper). */
export function guessEncodings(bytes) {
  const out = [];
  const push = (label, value, fmt = (v) => String(v)) => {
    if (value == null || Number.isNaN(value)) return;
    out.push({ label, text: fmt(value) });
  };

  for (let i = 0; i + 1 < bytes.length; i += 1) {
    push(`i16BE@${i}`, readInt16BE(bytes, i));
    push(`i16LE@${i}`, readInt16LE(bytes, i));
  }
  for (let i = 0; i + 3 < bytes.length; i += 1) {
    const be = readInt32BE(bytes, i);
    const le = readInt32LE(bytes, i);
    push(`i32BE@${i}`, be);
    push(`i32LE@${i}`, le);
    push(`i32BE/256@${i}`, be == null ? null : be / 256, (v) => v.toFixed(3));
    push(`i32LE/256@${i}`, le == null ? null : le / 256, (v) => v.toFixed(3));
    push(`f32BE@${i}`, readFloat32BE(bytes, i), (v) => v.toFixed(4));
  }
  return out;
}

function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function changedMask(prev, next) {
  const mask = [];
  const len = next?.length || 0;
  for (let i = 0; i < len; i += 1) {
    mask.push(!prev || prev[i] !== next[i]);
  }
  return mask;
}

/**
 * Build a full analyzer trace from candump text.
 */
export function analyzeCandumpText(text, { maxFrames = 20000 } = {}) {
  const lines = text.split(/\r?\n/);
  const frames = [];
  const latestById = new Map();
  const idStats = new Map();
  const latestSignals = {};
  let firstTs = null;
  let lastTs = null;
  let decodedFrames = 0;
  let unknownFrames = 0;

  for (const line of lines) {
    const parsed = parseCandumpLine(line);
    if (!parsed) continue;
    if (frames.length >= maxFrames) break;

    if (firstTs == null) firstTs = parsed.ts;
    lastTs = parsed.ts;

    const decoded = decodeRacepakFrame(parsed);
    const prev = latestById.get(parsed.idHex);
    const changed = !prev || !bytesEqual(prev.data, parsed.data);
    const deltaMs = prev ? (parsed.ts - prev.ts) * 1000 : null;

    const entry = {
      index: frames.length,
      ...parsed,
      baseIdHex: decoded.baseIdHex,
      known: decoded.known,
      signals: decoded.signals,
      changed,
      changeMask: changedMask(prev?.data, parsed.data),
      deltaMs,
    };
    frames.push(entry);
    latestById.set(parsed.idHex, entry);

    if (decoded.known) {
      decodedFrames += 1;
      for (const s of decoded.signals) {
        latestSignals[s.name] = {
          value: s.value,
          ts: parsed.ts,
          idHex: parsed.idHex,
        };
      }
    } else {
      unknownFrames += 1;
    }

    const st = idStats.get(parsed.idHex) || {
      idHex: parsed.idHex,
      baseIdHex: decoded.baseIdHex,
      count: 0,
      known: decoded.known,
      signals: decoded.signals.map((s) => s.name),
      lastDataHex: "",
      lastTs: 0,
    };
    st.count += 1;
    st.lastDataHex = parsed.dataHex;
    st.lastTs = parsed.ts;
    st.known = decoded.known;
    st.signals = decoded.signals.map((s) => s.name);
    idStats.set(parsed.idHex, st);
  }

  const durationSec =
    firstTs != null && lastTs != null ? Math.max(lastTs - firstTs, 0) : 0;

  const catalog = [...idStats.values()]
    .map((st) => ({
      ...st,
      hz: durationSec > 0 ? st.count / durationSec : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    summary: {
      frames: frames.length,
      uniqueIds: catalog.length,
      decodedFrames,
      unknownFrames,
      durationSec,
      knownSignalCount: Object.keys(latestSignals).length,
    },
    frames,
    catalog,
    latestSignals,
  };
}

/** Keep old helper for CLI. */
export function decodeCandumpText(text, opts = {}) {
  const analyzed = analyzeCandumpText(text, {
    maxFrames: opts.maxEvents || 5000,
  });
  const events = analyzed.frames
    .filter((f) => (opts.includeUnknown ? true : f.known))
    .map((f) => ({
      ts: f.ts,
      idHex: f.idHex,
      baseIdHex: f.baseIdHex,
      known: f.known,
      signals: f.signals,
      dataHex: f.dataHex,
    }));
  return {
    summary: analyzed.summary,
    latest: analyzed.latestSignals,
    events,
  };
}

export function formatSignal(name, value) {
  const meta = SIGNAL_META[name] || { unit: "", decimals: 2 };
  const num = Number(value);
  if (!Number.isFinite(num)) return { text: "—", unit: meta.unit };
  return {
    text: num.toFixed(meta.decimals),
    unit: meta.unit,
  };
}

export function formatDataBytes(dataHex, changeMask = null) {
  const pairs = dataHex.match(/.{1,2}/g) || [];
  return pairs.map((b, i) => ({
    hex: b,
    changed: changeMask ? !!changeMask[i] : false,
    index: i,
  }));
}
