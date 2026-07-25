/**
 * Browser-safe Racepak/Holley candump decoder.
 * Mirrors src/CAN/racepakDecoder.js (mask + big-endian /256 scaling).
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

function readInt32BE(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt32(offset, false);
}

function scaledBE(bytes, offset) {
  return readInt32BE(bytes, offset) / 256;
}

/** Racepak base ID mask used by AutoDashBackEnd */
const ID_MASK = 0xfffff800;

const RACEPAK_MAP = {
  0x1e001000: (data) => [{ name: "RPM", value: scaledBE(data, 4) }],
  0x1e005000: (data) => [{ name: "FUEL_FLOW", value: scaledBE(data, 4) }],
  0x1e029000: (data) => [{ name: "PEDAL_POSITION", value: scaledBE(data, 0) }],
  0x1e011000: (data) => [{ name: "TARGET_AFR", value: scaledBE(data, 0) }],
  0x1e015000: (data) => [
    { name: "IGNITION_TIMING", value: scaledBE(data, 0) },
    { name: "AFR_AVERAGE", value: scaledBE(data, 4) },
  ],
  0x1e019000: (data) => [{ name: "MAP", value: scaledBE(data, 0) }],
  0x1e01d000: (data) => [{ name: "MAT", value: scaledBE(data, 0) }],
  0x1e021000: (data) => [
    { name: "BAR_PRESSURE", value: scaledBE(data, 0) },
    { name: "CTS", value: scaledBE(data, 4) },
  ],
  0x1e025000: (data) => [
    { name: "OIL_PRESSURE", value: scaledBE(data, 0) },
    { name: "BATT_VOLTAGE", value: scaledBE(data, 4) },
  ],
};

/**
 * Parse one candump line:
 * (1620100659.576117) can0 1E0012D0#3D750CD300052C34
 */
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
  };
}

export function decodeRacepakFrame(frame) {
  const baseId = frame.id & ID_MASK;
  const handler = RACEPAK_MAP[baseId];
  if (!handler) {
    return { baseId, signals: [], known: false };
  }
  return { baseId, signals: handler(frame.data), known: true };
}

/**
 * Decode an entire candump text blob.
 * Returns latest values + event stream (known frames only by default).
 */
export function decodeCandumpText(text, { includeUnknown = false, maxEvents = 5000 } = {}) {
  const lines = text.split(/\r?\n/);
  const latest = {};
  const events = [];
  let parsed = 0;
  let decoded = 0;
  let unknown = 0;
  let firstTs = null;
  let lastTs = null;

  for (const line of lines) {
    const frame = parseCandumpLine(line);
    if (!frame) continue;
    parsed += 1;
    if (firstTs == null) firstTs = frame.ts;
    lastTs = frame.ts;

    const result = decodeRacepakFrame(frame);
    if (!result.known) {
      unknown += 1;
      if (includeUnknown && events.length < maxEvents) {
        events.push({
          ts: frame.ts,
          idHex: frame.idHex,
          baseIdHex: result.baseId.toString(16).toUpperCase(),
          known: false,
          signals: [],
        });
      }
      continue;
    }

    decoded += 1;
    for (const signal of result.signals) {
      latest[signal.name] = {
        value: signal.value,
        ts: frame.ts,
        idHex: frame.idHex,
      };
    }

    if (events.length < maxEvents) {
      events.push({
        ts: frame.ts,
        idHex: frame.idHex,
        baseIdHex: result.baseId.toString(16).toUpperCase(),
        known: true,
        signals: result.signals,
      });
    }
  }

  return {
    summary: {
      lines: lines.length,
      frames: parsed,
      decodedFrames: decoded,
      unknownFrames: unknown,
      durationSec: firstTs != null && lastTs != null ? lastTs - firstTs : 0,
      knownSignalCount: Object.keys(latest).length,
    },
    latest,
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
