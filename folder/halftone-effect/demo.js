import photo2 from "/src/assets/halftone-effect/photo-2.jpg";
import photo5 from "/src/assets/halftone-effect/photo-5.png";
import fontUrl from "/src/assets/fonts/Brut_Grotesque-Medium.otf";
import {
  clearPending,
  decodeSnapshot,
  finishBoot,
  loadPending,
  savePending,
  setBootImage,
  snapshotPage,
} from "./halftone/page-transition.js";

const photos = { a: photo2, e: photo5 };

const notice = document.querySelector("#notice");

let halftone = null;
let leaving = false;

const debug = {
  ready: false,
  get supported() {
    return halftone?.supported ?? false;
  },
  get backend() {
    return halftone?.backend ?? null;
  },
  get active() {
    return halftone?.active ?? false;
  },
  get busy() {
    return halftone?.busy ?? false;
  },
  get renderCount() {
    return halftone?.renderCount ?? 0;
  },
  get snapshotCached() {
    return halftone?.snapshotCached ?? false;
  },
  get lastTransition() {
    return halftone?.lastTransition ?? null;
  },
  navigate: (url) => {
    window.location.assign(url);
  },
};
window.__halftoneDebug = debug;

async function start() {
  for (const img of document.querySelectorAll("img[data-photo]")) {
    img.src = photos[img.dataset.photo] ?? photos.a;
  }

  const fontStyle = document.createElement("style");
  fontStyle.textContent = `@font-face { font-family: 'Brut Grotesque'; src: url("${fontUrl}") format('opentype'); font-weight: 500; font-display: swap; }`;
  document.head.appendChild(fontStyle);

  await Promise.all(
    [...document.images].map((img) => img.decode().catch(() => {})),
  );
  await document.fonts.ready;

  try {
    const { createHalftone } = await import("./halftone/index.js");
    halftone = await createHalftone({
      params: {
        dotSize: 4,
        designWidth: 399,
        dotScale: 1.05,
        softness: 0,
        rotation: -180,
        center: [0.1, 0.1],
        colorMode: 0,
      },
      zIndex: 40,
    });
  } catch (error) {
    console.error("[demo] halftone failed to start", error);
  }

  window.__halftone = halftone;
  debug.ready = true;

  if (!halftone || !halftone.supported) {
    notice.hidden = false;
    return;
  }

  setupControls();
  await setupPins();
  await resumePage();
}

/** Resume a cross-document transition on the incoming actual page. */
async function resumePage() {
  if (!halftone?.supported) return;
  const pending = await loadPending();
  if (!pending) return;

  setBootImage(pending.png);
  let outgoing = null;
  try {
    outgoing = await decodeSnapshot(pending.png);
    await halftone.transition(() => {}, {
      outgoing,
      outgoingParams: {
        gradient: { dark: "#82C1C0", light: "#FFFFFF" },
      },
      incomingParams: {
        gradient: { dark: "#B7BB92", light: "#FFFFFF" },
      },
      onOutReady: finishBoot,
    });
  } catch (error) {
    console.error("[demo] page transition failed", error);
  } finally {
    outgoing?.bitmap?.close?.();
    await clearPending();
  }
}

/* ------------------------------------------------------------------ */
/* EDIT THESE TWO OBJECTS TO CHANGE THE ROWS                           */
/* ------------------------------------------------------------------ */

// Row 1 — the commit's default one-layer treatment.
const FIRST = {
  // Pattern compositing: colour mode shows the gradient on the paper.
  pattern: { on: "color", paper: "#ccd391", blend: "multiply", opacity: 1 },

  // One layer. These are the defaults the control panel starts from.
  layers: [
    {
      halftone: {
        dotSize: 4,
        dotScale: 1.05,
        softness: 0,
        rotation: -180,
        center: [0.1, 0.1],
        halftoneType: 0,
        colorMode: 0,
        clipToAlpha: false,
        designWidth: 399,
        renderScale: 2,
        negative: false,
      },
      gradient: {
        enabled: true,
        stops: [
          { position: 0, color: "#94c182" },
          { position: 1, color: "#ffffff" },
        ],
        mixSpace: "sRGB",
        scatter: 0,
        offset: 0,
        repeat: "none",
        frequency: 2,
      },
    },
  ],
};

// Row 2 — two gradient layers multiplied together.
const ORANGE_LAYER = {
  gradient: { dark: "#FFFFFF", light: "#FF512F" },
  alpha: 0.95,
  negative: true,
};

const GREEN_LAYER = {
  gradient: { dark: "#5E8C4A", light: "#FFFFFF" },
  blend: "multiply",
  alpha: 0.55,
};

const SECOND = {
  pattern: { on: "color", paper: "#cad48a" },
  layers: [ORANGE_LAYER, GREEN_LAYER],
  // Pixels the top layer moves on hover.
  hoverOffset: [18, 18],
};

// Maps data-fx attributes in index.html to the objects above.
const PINS = {
  "single-default": FIRST,
  "two-hover": SECOND,
};

const ROW_IMAGES = {
  first: document.querySelector('img[data-fx="single-default"]'),
  second: document.querySelector('img[data-fx="two-hover"]'),
};

const ROW_CONFIGS = {
  first: FIRST,
  second: SECOND,
};

/** Pin the live row treatments and wire the top-layer hover shift. */
async function setupPins() {
  if (!halftone || !halftone.supported) return;
  const jobs = [];
  for (const img of document.querySelectorAll("img[data-fx]")) {
    const key = img.dataset.fx;
    const config = PINS[key];
    if (!config) continue;
    jobs.push(halftone.pin(img, config));
    const target = img.parentElement;
    target.addEventListener("pointerenter", () => {
      if (config.hoverOffset) halftone.shiftPin(img, config.hoverOffset, 240);
    });
    target.addEventListener("pointerleave", () => {
      const top = config.layers[config.layers.length - 1];
      if (config.hoverOffset && top)
        halftone.shiftPin(img, top.offset ?? [0, 0], 260);
    });
  }
  await Promise.all(jobs);
  halftone.sync();
}

function replaceConfig(target, next) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, next);
}

async function applyRow(name) {
  if (!halftone?.supported) return null;
  const img = ROW_IMAGES[name];
  if (!img) return null;
  return halftone.updatePin(img, ROW_CONFIGS[name]);
}

/**
 * Console API. Every value from the reference panel is reachable here.
 *
 *   __demo.set('first', { pattern, layers })
 *   __demo.setPattern('first', { paper: '#ffffff', blend: 'multiply' })
 *   __demo.setLayer('second', 1, { alpha: 0.5, blend: 'multiply' })
 *   __demo.setGradient('second', 1, { stops: [...] })
 *   __demo.hover('second', [24, 24])
 *   __demo.setGlobal({ dotSize: 8, colorMode: 1 })
 */
window.__demo = {
  get first() {
    return ROW_CONFIGS.first;
  },
  get second() {
    return ROW_CONFIGS.second;
  },

  get(name) {
    return ROW_CONFIGS[name] ?? null;
  },

  /** Replace a whole row config. */
  set(name, config) {
    if (!ROW_CONFIGS[name] || !config) return Promise.resolve(null);
    replaceConfig(ROW_CONFIGS[name], config);
    return applyRow(name);
  },

  /** Change one layer: gradient, halftone, alpha, offset, blend, negative. */
  setLayer(name, index, layer) {
    const config = ROW_CONFIGS[name];
    if (!config?.layers?.[index]) return Promise.resolve(null);
    config.layers[index] = { ...config.layers[index], ...layer };
    return applyRow(name);
  },

  addLayer(name, layer) {
    const config = ROW_CONFIGS[name];
    if (!config || !layer) return Promise.resolve(null);
    config.layers.push(layer);
    return applyRow(name);
  },

  removeLayer(name, index) {
    const config = ROW_CONFIGS[name];
    if (!config?.layers || config.layers.length <= 1)
      return Promise.resolve(null);
    config.layers.splice(index, 1);
    return applyRow(name);
  },

  setPattern(name, pattern) {
    const config = ROW_CONFIGS[name];
    if (!config) return Promise.resolve(null);
    config.pattern = { ...(config.pattern || {}), ...pattern };
    return applyRow(name);
  },

  setGradient(name, index, gradient) {
    const config = ROW_CONFIGS[name];
    if (!config?.layers?.[index]) return Promise.resolve(null);
    config.layers[index].gradient = gradient;
    return applyRow(name);
  },

  hover(name, offset) {
    const config = ROW_CONFIGS[name];
    if (!config) return Promise.resolve(null);
    config.hoverOffset = offset;
    return applyRow(name);
  },

  setGlobal(params) {
    return halftone?.setParams(params) ?? null;
  },

  async image(name, src) {
    const img = ROW_IMAGES[name];
    if (!img || !src) return null;
    img.src = src;
    await img.decode().catch(() => {});
    return applyRow(name);
  },

  apply(name) {
    return applyRow(name);
  },
};

console.info(
  '[demo] Control API: window.__demo. Try __demo.setPattern("first", { paper: "#fff" }) or __demo.setGlobal({ dotSize: 8 }).',
);

function setupControls() {
  const root = document.getElementById("controls");
  if (!root || !window.__demo) return;

  const first = window.__demo.first;
  const layer = first.layers[0];
  const halftone = layer.halftone;
  const pattern = first.pattern;
  const gradient = layer.gradient;
  const defaults = structuredClone(first);

  let timer = 0;
  const schedule = (fn) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      Promise.resolve(fn()).catch((error) => console.error("[controls]", error));
    }, 35);
  };

  const range = (id, label, min, max, step, value, unit = "") => `
    <label class="ctl-row" for="${id}">
      <span>${label}</span>
      <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
      <output id="${id}-out">${value}${unit}</output>
    </label>`;

  const select = (id, label, options, value) => `
    <label class="ctl-row" for="${id}">
      <span>${label}</span>
      <select id="${id}">
        ${options.map(([v, text]) => `<option value="${v}"${String(v) === String(value) ? " selected" : ""}>${text}</option>`).join("")}
      </select>
    </label>`;

  root.innerHTML = `
    <div class="ctl-head">
      <div>
        <strong>First image</strong>
        <p>Controls only the left image.</p>
      </div>
      <button type="button" id="c-reset">Reset</button>
    </div>

    <section class="ctl-group">
      <h3>Image</h3>
      ${select("c-on", "Pattern on", [["color", "Colour"], ["image", "Image"], ["original", "Original"]], pattern.on)}
      <label class="ctl-row" for="c-paper"><span>Paper</span><input id="c-paper" type="color" value="${pattern.paper}"></label>
      ${select("c-blend", "Blend", [["multiply", "Multiply"], ["darken", "Darken"], ["overlay", "Overlay"], ["screen", "Screen"], ["normal", "Normal"]], pattern.blend)}
      ${range("c-opacity", "Opacity", 0, 1, 0.01, pattern.opacity)}
      <label class="ctl-row" for="c-width"><span>Layer width</span><input id="c-width" type="number" min="100" max="1200" step="1" value="${halftone.designWidth}"></label>
    </section>

    <section class="ctl-group">
      <h3>Halftone</h3>
      ${select("c-type", "Pattern", [["0", "Dot"], ["1", "Blended"]], halftone.halftoneType)}
      ${select("c-mode", "Color mode", [["0", "CMYK"], ["1", "RGB"], ["2", "BW light"], ["3", "BW dark"]], halftone.colorMode)}
      ${range("c-dot", "Dot size", 1, 40, 0.5, halftone.dotSize, " px")}
      ${range("c-dot-scale", "Dot scale", 0, 2, 0.01, halftone.dotScale)}
      ${range("c-softness", "Softness", 0, 1, 0.01, halftone.softness)}
      ${range("c-rotation", "Rotation", -180, 180, 0.5, halftone.rotation, "°")}
      ${range("c-center-x", "Center X", 0, 100, 1, halftone.center[0] * 100, "%")}
      ${range("c-center-y", "Center Y", 0, 100, 1, halftone.center[1] * 100, "%")}
      <label class="ctl-check"><input id="c-clip" type="checkbox"${halftone.clipToAlpha ? " checked" : ""}> Clip to alpha</label>
      <label class="ctl-check"><input id="c-negative" type="checkbox"${halftone.negative ? " checked" : ""}> Negative</label>
    </section>

    <section class="ctl-group">
      <h3>Gradient map</h3>
      <label class="ctl-check"><input id="c-gradient" type="checkbox"${gradient.enabled ? " checked" : ""}> On</label>
      <div class="ctl-stops" id="c-stops"></div>
      <div class="ctl-buttons">
        <button type="button" id="c-add-stop">Add stop</button>
        <button type="button" id="c-reverse">Reverse</button>
      </div>
      ${select("c-mix", "Mix space", [["sRGB", "sRGB"], ["Linear", "Linear"], ["OKLab", "OKLab"]], gradient.mixSpace)}
      ${range("c-scatter", "Scatter", 0, 100, 0.1, gradient.scatter, "%")}
      ${range("c-offset", "Offset", -100, 100, 0.1, gradient.offset, "%")}
      ${select("c-repeat", "Repeat", [["none", "None"], ["repeat", "Repeat"], ["mirror", "Mirror"]], gradient.repeat)}
      ${range("c-frequency", "Frequency", 1, 10, 1, gradient.frequency)}
      <div class="ctl-row"><span>Apply</span><span class="ctl-static">After halftone</span></div>
    </section>
  `;

  const $ = (id) => root.querySelector(`#${id}`);
  const out = (id) => root.querySelector(`#${id}-out`);
  const applyHalftone = () => schedule(() => window.__demo.setLayer("first", 0, { halftone }));
  const applyGradient = () => schedule(() => window.__demo.setGradient("first", 0, gradient));
  const applyPattern = () => schedule(() => window.__demo.setPattern("first", pattern));

  const bindRange = (id, unit, handler) => {
    const input = $(id);
    input.addEventListener("input", () => {
      const value = Number(input.value);
      out(id).textContent = `${value}${unit}`;
      handler(value);
    });
  };

  $("c-on").addEventListener("change", () => { pattern.on = $("c-on").value; applyPattern(); });
  $("c-paper").addEventListener("input", () => { pattern.paper = $("c-paper").value; applyPattern(); });
  $("c-blend").addEventListener("change", () => { pattern.blend = $("c-blend").value; applyPattern(); });
  bindRange("c-opacity", "", (v) => { pattern.opacity = v; applyPattern(); });
  $("c-width").addEventListener("input", () => { halftone.designWidth = Math.max(100, Number($("c-width").value) || 399); applyHalftone(); });

  $("c-type").addEventListener("change", () => { halftone.halftoneType = Number($("c-type").value); applyHalftone(); });
  $("c-mode").addEventListener("change", () => { halftone.colorMode = Number($("c-mode").value); applyHalftone(); });
  bindRange("c-dot", " px", (v) => { halftone.dotSize = v; applyHalftone(); });
  bindRange("c-dot-scale", "", (v) => { halftone.dotScale = v; applyHalftone(); });
  bindRange("c-softness", "", (v) => { halftone.softness = v; applyHalftone(); });
  bindRange("c-rotation", "°", (v) => { halftone.rotation = v; applyHalftone(); });
  bindRange("c-center-x", "%", (v) => { halftone.center[0] = v / 100; applyHalftone(); });
  bindRange("c-center-y", "%", (v) => { halftone.center[1] = v / 100; applyHalftone(); });
  $("c-clip").addEventListener("change", () => { halftone.clipToAlpha = $("c-clip").checked; applyHalftone(); });
  $("c-negative").addEventListener("change", () => { halftone.negative = $("c-negative").checked; applyHalftone(); });

  $("c-gradient").addEventListener("change", () => { gradient.enabled = $("c-gradient").checked; applyGradient(); });
  $("c-mix").addEventListener("change", () => { gradient.mixSpace = $("c-mix").value; applyGradient(); });
  $("c-repeat").addEventListener("change", () => { gradient.repeat = $("c-repeat").value; applyGradient(); });
  bindRange("c-scatter", "%", (v) => { gradient.scatter = v; applyGradient(); });
  bindRange("c-offset", "%", (v) => { gradient.offset = v; applyGradient(); });
  bindRange("c-frequency", "", (v) => { gradient.frequency = v; applyGradient(); });

  const renderStops = () => {
    const box = $("c-stops");
    box.innerHTML = "";
    gradient.stops.forEach((stop, index) => {
      const row = document.createElement("div");
      row.className = "ctl-stop";
      row.innerHTML = `
        <input type="color" value="${stop.color}" aria-label="Stop ${index + 1} colour">
        <input type="range" min="0" max="100" step="1" value="${Math.round(stop.position * 100)}" aria-label="Stop ${index + 1} position">
        <span>${Math.round(stop.position * 100)}%</span>
        <button type="button" aria-label="Remove stop ${index + 1}">×</button>`;
      const [color, position, value, remove] = row.children;
      color.addEventListener("input", () => { stop.color = color.value; applyGradient(); });
      position.addEventListener("input", () => {
        stop.position = Number(position.value) / 100;
        value.textContent = `${position.value}%`;
        applyGradient();
      });
      remove.addEventListener("click", () => {
        if (gradient.stops.length <= 1) return;
        gradient.stops.splice(index, 1);
        renderStops();
        applyGradient();
      });
      box.appendChild(row);
    });
    $("c-add-stop").disabled = gradient.stops.length >= 8;
  };

  $("c-add-stop").addEventListener("click", () => {
    if (gradient.stops.length >= 8) return;
    const sorted = [...gradient.stops].sort((a, b) => a.position - b.position);
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2] || { position: 0 };
    gradient.stops.push({ position: (last.position + prev.position) / 2, color: last.color });
    renderStops();
    applyGradient();
  });

  $("c-reverse").addEventListener("click", () => {
    gradient.stops.forEach((stop) => { stop.position = 1 - stop.position; });
    renderStops();
    applyGradient();
  });

  $("c-reset").addEventListener("click", () => {
    for (const key of Object.keys(first)) delete first[key];
    Object.assign(first, structuredClone(defaults));
    setupControls();
    void window.__demo.apply("first");
  });

  renderStops();
}

const hfForm = document.querySelector(".hf-form");
if (hfForm) {
  hfForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector("#hf-email");
    const error = document.querySelector(".hf-error");
    const valid = Boolean(input?.value) && input.checkValidity();
    if (error) error.style.visibility = valid ? "hidden" : "visible";
    if (valid && input) input.value = "";
  });
}

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      const previous = button.textContent;
      button.textContent = "✓";
      window.setTimeout(() => {
        button.textContent = previous;
      }, 1200);
    } catch {
      /* clipboard unavailable */
    }
  });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[data-page-transition]");
  if (!link || leaving) return;
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    link.target ||
    link.hasAttribute("download")
  ) {
    return;
  }
  const url = new URL(link.href, window.location.href);
  if (url.origin !== window.location.origin) return;
  if (!halftone?.supported) return;

  event.preventDefault();
  leaving = true;
  document.documentElement.setAttribute("aria-busy", "true");
  void (async () => {
    try {
      await savePending(await snapshotPage());
    } catch (error) {
      console.error("[demo] could not save outgoing page", error);
    }
    window.location.assign(url.href);
  })();
});

void start();
