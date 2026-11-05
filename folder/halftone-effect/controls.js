/** Defaults and UI for the left/first image only. */
export function createFirstConfig() {
  return {
    pattern: { on: "color", paper: "#ccd391", blend: "multiply", opacity: 1 },
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
}

export function setupControls(api, first) {
  const root = document.getElementById("controls");
  if (!root || !api) return;
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
      <h3>Page transition</h3>
      ${range("c-transition-speed", "Speed", 0.5, 2, 0.1, api.transitionSpeed ?? 1, "×")}
      <p class="ctl-hint">Higher is faster. Applies to both pages.</p>
    </section>

    <section class="ctl-group">
      <h3>Scroll image</h3>
      ${select("c-scroll-once", "Fade", [["once", "Once"], ["every", "Every time"]], api.scrollRevealOnce ? "once" : "every")}
      ${range("c-scroll-hold", "Hold after visible", 0, 10, 0.1, api.scrollRevealHold ?? 3, "s")}
      ${range("c-scroll-fade", "Fade time", 0.1, 8, 0.1, api.scrollRevealFade ?? 1.8, "s")}
      <p class="ctl-hint">The pattern waits until the image is fully in view.</p>
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
  const applyHalftone = () => schedule(() => api.setLayer("first", 0, { halftone }));
  const applyGradient = () => schedule(() => api.setGradient("first", 0, gradient));
  const applyPattern = () => schedule(() => api.setPattern("first", pattern));

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
  bindRange("c-transition-speed", "×", (v) => { api.setTransitionSpeed(v); });
  bindRange("c-scroll-hold", "s", (v) => { api.setScrollRevealTiming({ hold: v }); });
  bindRange("c-scroll-fade", "s", (v) => { api.setScrollRevealTiming({ fade: v }); });
  $("c-scroll-once").addEventListener("change", () => {
    api.setScrollRevealTiming({ once: $("c-scroll-once").value === "once" });
  });

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
    setupControls(api, first);
    void api.apply("first");
  });

  renderStops();
}

