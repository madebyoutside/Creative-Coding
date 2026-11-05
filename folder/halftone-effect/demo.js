import photo2 from "/src/assets/halftone-effect/photo-2.jpg";
import photo5 from "/src/assets/halftone-effect/photo-5.png";
import fontUrl from "/src/assets/fonts/Brut_Grotesque-Medium.otf";
import { createFirstConfig, setupControls } from "./controls.js";
import Swup from "swup";

const photos = { a: photo2, e: photo5 };

let halftone = null;
let swup = null;

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
    if (swup) {
      swup.navigate(url);
    } else {
      window.location.assign(url);
    }
  },
};
window.__halftoneDebug = debug;

/* ------------------------------------------------------------------ */
/* EDIT THESE TWO OBJECTS TO CHANGE THE ROWS                           */
/* ------------------------------------------------------------------ */

const FIRST = createFirstConfig();

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
  first: null,
  second: null,
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

/** Wire interactive handlers on the Coalition page. */
function setupCoalitionHandlers() {
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
}

/** Initialize content for the current view: images, fonts, controls, pins or handlers. */
async function initPage() {
  const isCoalition = document.body.dataset.page === "coalition";

  // Populate images from photos dictionary
  for (const img of document.querySelectorAll("img[data-photo]")) {
    img.src = photos[img.dataset.photo] ?? photos.a;
  }

  // Ensure all images are decoded before taking any transition snapshot
  await Promise.all(
    [...document.images].map((img) => img.decode().catch(() => {})),
  );

  // Update active page links in navigation
  for (const link of document.querySelectorAll(".site-nav a")) {
    const href = link.getAttribute("href") || "";
    const isIndex =
      href === "./" ||
      href === "index.html" ||
      href === "" ||
      href.endsWith("/halftone-effect/") ||
      href.endsWith("/halftone-effect/index.html");
    if (!isCoalition && isIndex) {
      link.setAttribute("aria-current", "page");
    } else if (isCoalition && href.includes("coalition")) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }

  // Page-specific setup
  if (isCoalition) {
    setupCoalitionHandlers();
  } else {
    ROW_IMAGES.first = document.querySelector('img[data-fx="single-default"]');
    ROW_IMAGES.second = document.querySelector('img[data-fx="two-hover"]');
    setupControls(window.__demo, FIRST);
    await setupPins();
  }
}

/** Wire Swup with the halftone cross-page transition effect. */
function setupSwup() {
  swup = new Swup({
    containers: ["#app"],
    animationSelector: false,
    animateHistoryBrowsing: true,
    linkSelector: "a[data-page-transition]",
    resolveUrl: (url) => url.replace(/\/index\.html$/, "/"),
  });

  swup.hooks.before("link:click", (visit, { event }) => {
    if (halftone?.busy) {
      visit.ignored = true;
      event.preventDefault();
    }
  });

  swup.hooks.on("visit:start", (visit) => {
    visit.animation.wait = true;
    document.documentElement.setAttribute("aria-busy", "true");
  });

  swup.hooks.replace("visit:transition", async (visit, args, defaultHandler) => {
    if (!halftone?.supported) {
      if (visit.to.document?.body?.dataset?.page) {
        document.body.dataset.page = visit.to.document.body.dataset.page;
      }
      await defaultHandler(visit, args);
      await initPage();
      return;
    }

    let pageData = { url: visit.to.url, html: visit.to.html };
    if (!pageData.html) {
      const fetched = await swup.fetchPage(visit.to.url);
      pageData = fetched;
      visit.to.html = fetched.html;
      visit.to.document = new DOMParser().parseFromString(fetched.html, "text/html");
    }

    const doc = visit.to.document;

    await halftone.transition(
      async () => {
        // 1. Release live pins from the outgoing page
        halftone.unpinAll();

        // 2. Sync body dataset.page attribute so page-level styles match immediately
        if (doc?.body?.dataset?.page) {
          document.body.dataset.page = doc.body.dataset.page;
        }

        // 3. Swap container contents using Swup
        await swup.renderPage(visit, pageData);

        // 4. Initialize images, pins, and controls on the incoming page
        await initPage();
      },
      {
        outgoingParams: {
          gradient: { dark: "#82C1C0", light: "#FFFFFF" },
        },
        incomingParams: {
          gradient: { dark: "#B7BB92", light: "#FFFFFF" },
        },
      },
    );
  });

  swup.hooks.on("visit:end", () => {
    document.documentElement.removeAttribute("aria-busy");
  });

  swup.hooks.on("visit:abort", () => {
    document.documentElement.removeAttribute("aria-busy");
  });

  swup.hooks.on("visit:fail", () => {
    document.documentElement.removeAttribute("aria-busy");
  });
}

async function start() {
  // Clear any legacy session markers
  try {
    sessionStorage.removeItem("halftone:page");
    sessionStorage.removeItem("halftone:boot");
    document.documentElement.classList.remove("halftone-booting");
  } catch {}

  const fontStyle = document.createElement("style");
  fontStyle.textContent = `@font-face { font-family: 'Brut Grotesque'; src: url("${fontUrl}") format('opentype'); font-weight: 500; font-display: swap; }`;
  document.head.appendChild(fontStyle);

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

  const notice = document.querySelector("#notice");
  if (!halftone || !halftone.supported) {
    if (notice) notice.hidden = false;
  }

  await initPage();
  setupSwup();
}

void start();
