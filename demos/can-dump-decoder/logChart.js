const COLORS = [
  "#3dba7a",
  "#ffe08a",
  "#69a7ff",
  "#e09145",
  "#d98cff",
  "#53d4d1",
  "#ff7f96",
  "#b4d76b",
];

function seriesLabel(key) {
  if (key.startsWith("signal:")) return key.slice(7).replaceAll("_", " ");
  const [, id, byte] = key.split(":");
  return `${id} B${byte}`;
}

function pointsFor(key, frames) {
  if (key.startsWith("signal:")) {
    const name = key.slice(7);
    const points = [];
    for (const frame of frames) {
      for (const signal of frame.signals || []) {
        if (signal.name === name && Number.isFinite(Number(signal.value))) {
          points.push({ t: frame.ts, value: Number(signal.value), index: frame.index });
        }
      }
    }
    return points;
  }

  const [, idHex, byteText] = key.split(":");
  const byteIndex = Number(byteText);
  return frames
    .filter((frame) => frame.idHex === idHex && byteIndex < frame.data.length)
    .map((frame) => ({
      t: frame.ts,
      value: frame.data[byteIndex],
      index: frame.index,
    }));
}

function downsample(points, max = 1200) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i += 1) {
    out.push(points[Math.floor(i * step)]);
  }
  out.push(points[points.length - 1]);
  return out;
}

export function createLogChart({ getState, onSeek }) {
  const canvas = document.getElementById("logChart");
  const ctx = canvas.getContext("2d");
  const picker = document.getElementById("chartSeries");
  const addBtn = document.getElementById("chartAdd");
  const clearBtn = document.getElementById("chartClear");
  const resetBtn = document.getElementById("chartReset");
  const normalize = document.getElementById("chartNormalize");
  const startRange = document.getElementById("rangeStart");
  const endRange = document.getElementById("rangeEnd");
  const startLabel = document.getElementById("rangeStartLabel");
  const endLabel = document.getElementById("rangeEndLabel");
  const legend = document.getElementById("chartLegend");
  const empty = document.getElementById("chartEmpty");
  const cursor = document.getElementById("chartCursor");

  let active = ["signal:RPM", "signal:CTS", "signal:BATT_VOLTAGE"];
  let availableKey = "";
  let lastPlot = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function updateOptions() {
    const state = getState();
    const signals = new Set();
    for (const frame of state.frames) {
      for (const signal of frame.signals || []) signals.add(signal.name);
    }
    const ids = state.catalog.slice(0, 80);
    const key = `${[...signals].sort().join(",")}|${ids.map((x) => x.idHex).join(",")}`;
    if (key === availableKey) return;
    availableKey = key;

    const prior = picker.value;
    const signalOptions = [...signals]
      .sort()
      .map((name) => `<option value="signal:${name}">${name.replaceAll("_", " ")}</option>`)
      .join("");
    const byteOptions = ids
      .map((id) =>
        Array.from(
          { length: Math.min(8, state.frames.find((f) => f.idHex === id.idHex)?.dlc || 8) },
          (_, byte) =>
            `<option value="byte:${id.idHex}:${byte}">${id.idHex} byte ${byte}</option>`
        ).join("")
      )
      .join("");
    picker.innerHTML = `
      <optgroup label="Decoded signals">${signalOptions || '<option disabled>None mapped</option>'}</optgroup>
      <optgroup label="Raw CAN bytes">${byteOptions}</optgroup>
    `;
    if ([...picker.options].some((o) => o.value === prior)) picker.value = prior;
  }

  function renderLegend() {
    legend.innerHTML = active
      .map(
        (key, i) => `
          <button class="legend-chip" type="button" data-series="${key}" title="Remove series">
            <span class="legend-swatch" style="background:${COLORS[i % COLORS.length]}"></span>
            ${seriesLabel(key)} ×
          </button>`
      )
      .join("");
  }

  function visibleTime(frames) {
    if (!frames.length) return null;
    const allMin = frames[0].ts;
    const allMax = frames[frames.length - 1].ts;
    const span = Math.max(allMax - allMin, 0.001);
    const start = Number(startRange.value) / 100;
    const end = Number(endRange.value) / 100;
    return {
      allMin,
      allMax,
      min: allMin + span * start,
      max: allMin + span * end,
    };
  }

  function drawGrid(width, height, pad, time) {
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "#2a3530";
    ctx.fillStyle = "#8fa399";
    ctx.lineWidth = 1;
    ctx.font = "10px IBM Plex Mono, monospace";
    for (let i = 0; i <= 5; i += 1) {
      const x = pad.left + ((width - pad.left - pad.right) * i) / 5;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, height - pad.bottom);
      ctx.stroke();
      const seconds = time.min - time.allMin + ((time.max - time.min) * i) / 5;
      ctx.fillText(`${seconds.toFixed(3)}s`, x - 13, height - 7);
    }
    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + ((height - pad.top - pad.bottom) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillText(`${Math.round((1 - i / 4) * 100)}%`, 4, y + 3);
    }
  }

  function draw() {
    updateOptions();
    renderLegend();
    const { frames, selectedIndex } = getState();
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const pad = { left: 34, right: 12, top: 12, bottom: 25 };
    const time = visibleTime(frames);
    empty.hidden = !!(time && active.length);
    lastPlot = null;

    ctx.clearRect(0, 0, width, height);
    if (!time || !active.length) return;
    drawGrid(width, height, pad, time);

    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const plotted = [];
    const prepared = active.map((key) => ({
      key,
      points: downsample(
        pointsFor(key, frames).filter(
          (point) => point.t >= time.min && point.t <= time.max
        )
      ),
    }));
    const allValues = prepared.flatMap((series) =>
      series.points.map((point) => point.value)
    );
    const globalMin = allValues.length ? Math.min(...allValues) : 0;
    const globalMax = allValues.length ? Math.max(...allValues) : 1;

    prepared.forEach(({ key, points }, seriesIndex) => {
      if (!points.length) return;
      const values = points.map((point) => point.value);
      let min = normalize.checked ? Math.min(...values) : globalMin;
      let max = normalize.checked ? Math.max(...values) : globalMax;
      if (max === min) {
        min -= 1;
        max += 1;
      }
      ctx.strokeStyle = COLORS[seriesIndex % COLORS.length];
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      points.forEach((point, i) => {
        const x = pad.left + ((point.t - time.min) / (time.max - time.min)) * plotWidth;
        const y = pad.top + (1 - (point.value - min) / (max - min)) * plotHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      plotted.push({ key, points, min, max });
    });

    const selected = frames.find((frame) => frame.index === selectedIndex);
    if (selected && selected.ts >= time.min && selected.ts <= time.max) {
      const x = pad.left + ((selected.ts - time.min) / (time.max - time.min)) * plotWidth;
      ctx.strokeStyle = "#e7eee9";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, height - pad.bottom);
      ctx.stroke();
    }

    lastPlot = { time, pad, width, height, plotted };
  }

  function seekFromPointer(event) {
    if (!lastPlot) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const { time, pad, width, plotted } = lastPlot;
    const ratio = Math.max(
      0,
      Math.min(1, (x - pad.left) / (width - pad.left - pad.right))
    );
    const target = time.min + (time.max - time.min) * ratio;
    const candidates = plotted.flatMap((series) => series.points);
    if (!candidates.length) return;
    let nearest = candidates[0];
    for (const point of candidates) {
      if (Math.abs(point.t - target) < Math.abs(nearest.t - target)) nearest = point;
    }
    const values = plotted
      .map((series) => {
        let point = series.points[0];
        for (const candidate of series.points) {
          if (Math.abs(candidate.t - nearest.t) < Math.abs(point.t - nearest.t)) {
            point = candidate;
          }
        }
        return `${seriesLabel(series.key)}=${point.value.toFixed(2)}`;
      })
      .join(" · ");
    cursor.textContent = `t+${(nearest.t - time.allMin).toFixed(4)}s · ${values}`;
    onSeek(nearest.index);
  }

  addBtn.addEventListener("click", () => {
    if (picker.value && !active.includes(picker.value)) active.push(picker.value);
    draw();
  });
  clearBtn.addEventListener("click", () => {
    active = [];
    draw();
  });
  legend.addEventListener("click", (event) => {
    const button = event.target.closest("[data-series]");
    if (!button) return;
    active = active.filter((key) => key !== button.dataset.series);
    draw();
  });
  resetBtn.addEventListener("click", () => {
    startRange.value = "0";
    endRange.value = "100";
    startLabel.value = "0%";
    endLabel.value = "100%";
    draw();
  });
  startRange.addEventListener("input", () => {
    if (Number(startRange.value) >= Number(endRange.value)) {
      startRange.value = String(Number(endRange.value) - 1);
    }
    startLabel.value = `${startRange.value}%`;
    draw();
  });
  endRange.addEventListener("input", () => {
    if (Number(endRange.value) <= Number(startRange.value)) {
      endRange.value = String(Number(startRange.value) + 1);
    }
    endLabel.value = `${endRange.value}%`;
    draw();
  });
  normalize.addEventListener("change", draw);
  canvas.addEventListener("pointerdown", seekFromPointer);

  new ResizeObserver(resize).observe(canvas.parentElement);

  return {
    refresh: draw,
    focusId(idHex) {
      picker.value = `byte:${idHex}:0`;
    },
  };
}
