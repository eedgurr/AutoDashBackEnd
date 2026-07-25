/**
 * Lightweight canvas 3D surface for calibration / XDF tables.
 * Inspired by hjtrbo/Table-Editor-3D (grid ↔ surface), but browser-only —
 * no WinForms / Editor3D dependency.
 */

export function createSurface3D(canvas, options = {}) {
  const state = {
    xLabels: [],
    yLabels: [],
    zGrid: [],
    xName: options.xName || "X",
    yName: options.yName || "Y",
    zName: options.zName || "Z",
    title: options.title || "",
    yaw: options.yaw ?? -0.85,
    pitch: options.pitch ?? 0.55,
    zoom: options.zoom ?? 280,
    transpose: false,
    marker: null, // { xi, yi } cell indices in current grid orientation
    dragging: false,
    lastX: 0,
    lastY: 0,
  };

  const metaEl = options.metaEl || null;

  function numericGrid() {
    const rows = state.zGrid.length;
    const cols = rows ? state.zGrid[0].length : 0;
    const values = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const value = Number(state.zGrid[r][c]);
        if (Number.isFinite(value)) values.push(value);
      }
    }
    return { rows, cols, values };
  }

  function oriented() {
    if (!state.transpose) {
      return {
        xLabels: state.xLabels,
        yLabels: state.yLabels,
        zGrid: state.zGrid,
        xName: state.xName,
        yName: state.yName,
      };
    }
    const rows = state.zGrid.length;
    const cols = rows ? state.zGrid[0].length : 0;
    const zGrid = Array.from({ length: cols }, (_, c) =>
      Array.from({ length: rows }, (_, r) => state.zGrid[r][c])
    );
    return {
      xLabels: state.yLabels,
      yLabels: state.xLabels,
      zGrid,
      xName: state.yName,
      yName: state.xName,
    };
  }

  function project(x, y, z, width, height) {
    const cosY = Math.cos(state.yaw);
    const sinY = Math.sin(state.yaw);
    const cosP = Math.cos(state.pitch);
    const sinP = Math.sin(state.pitch);
    const x1 = x * cosY - z * sinY;
    const z1 = x * sinY + z * cosY;
    const y1 = y * cosP - z1 * sinP;
    const z2 = y * sinP + z1 * cosP;
    const scale = state.zoom / (3.6 + z2);
    return {
      x: width * 0.5 + x1 * scale,
      y: height * 0.52 - y1 * scale,
      depth: z2,
    };
  }

  function colorFor(ratio) {
    const hue = 215 - ratio * 175;
    const light = 22 + ratio * 30;
    return `hsl(${hue} 58% ${light}%)`;
  }

  function updateMeta(view) {
    if (!metaEl) return;
    const { values } = numericGrid();
    if (!values.length) {
      metaEl.textContent = "No table data";
      return;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    metaEl.textContent = `${state.title || "3D map"} · ${view.yName} × ${
      view.xName
    } → ${state.zName} · z ${min.toFixed(2)}…${max.toFixed(2)} · drag to rotate · wheel/pinch zoom`;
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "#0b100e";
    ctx.fillRect(0, 0, width, height);

    const view = oriented();
    updateMeta(view);
    const rows = view.zGrid.length;
    const cols = rows ? view.zGrid[0].length : 0;
    if (!rows || !cols) {
      ctx.fillStyle = "#8fa399";
      ctx.font = "13px IBM Plex Sans";
      ctx.fillText("Load a table to render the surface", 16, 28);
      return;
    }

    const flat = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const value = Number(view.zGrid[r][c]);
        if (Number.isFinite(value)) flat.push(value);
      }
    }
    const min = Math.min(...flat);
    const max = Math.max(...flat);
    const span = Math.max(max - min, 1e-9);

    const points = Array.from({ length: rows }, () => Array(cols));
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const value = Number(view.zGrid[r][c]);
        const nx = cols === 1 ? 0 : (c / (cols - 1)) * 2 - 1;
        const ny = rows === 1 ? 0 : (r / (rows - 1)) * 2 - 1;
        const nz = Number.isFinite(value) ? ((value - min) / span) * 1.15 - 0.2 : 0;
        points[r][c] = {
          ...project(nx, nz, ny, width, height),
          value,
          ratio: Number.isFinite(value) ? (value - min) / span : 0,
        };
      }
    }

    const quads = [];
    for (let r = 0; r < rows - 1; r += 1) {
      for (let c = 0; c < cols - 1; c += 1) {
        const a = points[r][c];
        const b = points[r][c + 1];
        const d = points[r + 1][c + 1];
        const e = points[r + 1][c];
        quads.push({
          pts: [a, b, d, e],
          depth: (a.depth + b.depth + d.depth + e.depth) / 4,
          ratio: (a.ratio + b.ratio + d.ratio + e.ratio) / 4,
        });
      }
    }
    quads.sort((left, right) => right.depth - left.depth);

    for (const quad of quads) {
      ctx.beginPath();
      ctx.moveTo(quad.pts[0].x, quad.pts[0].y);
      for (let i = 1; i < 4; i += 1) ctx.lineTo(quad.pts[i].x, quad.pts[i].y);
      ctx.closePath();
      ctx.fillStyle = colorFor(quad.ratio);
      ctx.fill();
      ctx.strokeStyle = "rgba(8, 14, 12, 0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Wireframe nodes for clearer "map" feel on phones.
    ctx.fillStyle = "#d7e4db";
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const point = points[r][c];
        ctx.beginPath();
        ctx.arc(point.x, point.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (
      state.marker &&
      state.marker.yi >= 0 &&
      state.marker.xi >= 0 &&
      state.marker.yi < rows &&
      state.marker.xi < cols
    ) {
      const mark = points[state.marker.yi][state.marker.xi];
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.strokeRect(mark.x - 6, mark.y - 6, 12, 12);
      ctx.fillStyle = "#ffe08a";
      ctx.font = "11px IBM Plex Mono";
      const label = Number.isFinite(mark.value) ? mark.value.toFixed(2) : "—";
      ctx.fillText(label, mark.x + 8, mark.y - 8);
    }

    // Axis cues
    ctx.fillStyle = "#8fa399";
    ctx.font = "11px IBM Plex Sans";
    ctx.fillText(`${view.xName} →`, 12, height - 14);
    ctx.fillText(`↑ ${state.zName}`, 12, 18);
    if (view.xLabels.length) {
      ctx.fillText(String(view.xLabels[0]), 12, height - 28);
      ctx.fillText(
        String(view.xLabels[view.xLabels.length - 1]),
        width - 54,
        height - 14
      );
    }
  }

  function setData({
    xLabels = [],
    yLabels = [],
    zGrid = [],
    xName,
    yName,
    zName,
    title,
  } = {}) {
    state.xLabels = xLabels;
    state.yLabels = yLabels;
    state.zGrid = zGrid;
    if (xName != null) state.xName = xName;
    if (yName != null) state.yName = yName;
    if (zName != null) state.zName = zName;
    if (title != null) state.title = title;
    draw();
  }

  function setMarker(marker) {
    state.marker = marker;
    draw();
  }

  function setTranspose(value) {
    state.transpose = Boolean(value);
    draw();
  }

  function resetView() {
    state.yaw = -0.85;
    state.pitch = 0.55;
    state.zoom = 280;
    draw();
  }

  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", (event) => {
    state.dragging = true;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!state.dragging) return;
    const dx = event.clientX - state.lastX;
    const dy = event.clientY - state.lastY;
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    state.yaw += dx * 0.01;
    state.pitch = Math.max(
      0.15,
      Math.min(1.25, state.pitch + dy * 0.01)
    );
    draw();
  });
  const endDrag = (event) => {
    state.dragging = false;
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      state.zoom = Math.max(120, Math.min(620, state.zoom - event.deltaY * 0.35));
      draw();
    },
    { passive: false }
  );

  let pinchStart = null;
  canvas.addEventListener("touchstart", (event) => {
    if (event.touches.length === 2) {
      const [a, b] = event.touches;
      pinchStart = {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        zoom: state.zoom,
      };
    }
  });
  canvas.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length === 2 && pinchStart) {
        event.preventDefault();
        const [a, b] = event.touches;
        const distance = Math.hypot(
          a.clientX - b.clientX,
          a.clientY - b.clientY
        );
        state.zoom = Math.max(
          120,
          Math.min(620, pinchStart.zoom * (distance / pinchStart.distance))
        );
        draw();
      }
    },
    { passive: false }
  );
  canvas.addEventListener("touchend", () => {
    pinchStart = null;
  });

  new ResizeObserver(draw).observe(canvas);
  draw();

  return { setData, setMarker, setTranspose, resetView, draw };
}
