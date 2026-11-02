import photo2 from "/src/assets/halftone-effect/photo-2.jpg";
import photo5 from "/src/assets/halftone-effect/photo-5.png";
import fontUrl from "/src/assets/fonts/Brut_Grotesque-Medium.otf";

const photos = { a: photo2, e: photo5 };

const views = Object.fromEntries(
  [...document.querySelectorAll(".view")].map((view) => [
    view.dataset.view,
    view,
  ]),
);
const navLinks = [...document.querySelectorAll("[data-nav]")];
const notice = document.querySelector("#notice");

let halftone = null;
let currentPage = "index";
let chain = Promise.resolve();
let pendingNav = 0;

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
  navigate: (name) => navigate(name),
};
window.__halftoneDebug = debug;

/** Resolve the initial view from the URL hash. */
function pageFromHash() {
  const name = window.location.hash.replace("#", "");
  return views[name] ? name : "index";
}

/** Show one view, refresh nav state and rebake pinned effects. */
function applyPage(name, { push = false, focus = false } = {}) {
  currentPage = name;
  document.body.classList.toggle("is-coalition", name === "studio");
  for (const [key, view] of Object.entries(views)) view.hidden = key !== name;
  for (const link of navLinks) {
    if (link.dataset.nav === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (push) window.history.pushState({ page: name }, "", `#${name}`);
  if (focus) views[name]?.querySelector("h1")?.focus({ preventScroll: true });
  halftone?.sync();
  if (halftone?.supported) {
    window.requestAnimationFrame(() => {
      halftone.sync();
      void setupPins();
    });
  }
}

/** Crossfade to another view with the snapshot transition. */
function navigate(name, { push = true } = {}) {
  if (!views[name] || name === currentPage) return;

  const update = () => applyPage(name, { push, focus: true });

  if (!halftone || !halftone.supported) {
    update();
    return;
  }

  pendingNav += 1;
  document.documentElement.setAttribute("aria-busy", "true");
  chain = chain
    .then(() =>
      halftone.transition(update, {
        // Outgoing teal, incoming olive; the page multiply is skipped.
        outgoingParams: {
          gradient: { dark: "#82C1C0", light: "#FFFFFF", blend: "replace" },
        },
        incomingParams: {
          gradient: { dark: "#B7BB92", light: "#FFFFFF", blend: "replace" },
        },
      }),
    )
    .catch((error) => {
      console.error("[demo] transition failed", error);
      update();
    })
    .finally(() => {
      pendingNav -= 1;
      if (pendingNav <= 0)
        document.documentElement.removeAttribute("aria-busy");
    });
}

document.addEventListener("click", (event) => {
  const link = event.target.closest?.("[data-nav]");
  if (!link) return;
  const name = link.dataset.nav;
  if (!views[name]) return;
  event.preventDefault();
  navigate(name, { push: true });
});

window.addEventListener("popstate", () => {
  const name = pageFromHash();
  if (name !== currentPage) navigate(name, { push: false });
});

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
        dotScale: 1.05,
        softness: 0,
        rotation: -Math.PI, // Figma slider is -180 degrees
        center: [0.1, 0.1],
        colorMode: 0,
        gradient: { dark: "#82C1C0", light: "#FFFFFF", blend: "replace" },
        multiplyColor: "#CAD48A",
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

  await setupPins();
}

const SINGLE = {
  "single-green": {
    layers: [
      { gradient: { dark: "#5E8C4A", light: "#FFFFFF" }, multiplyColor: "#CAD48A" },
    ],
  },
  "single-orange": {
    layers: [
      { gradient: { dark: "#D14A2E", light: "#FFFFFF" }, multiplyColor: "#F26B4E" },
    ],
  },
  "single-teal": {
    layers: [
      { gradient: { dark: "#1F7A7A", light: "#FFFFFF" }, multiplyColor: "#A8D8D8" },
    ],
  },
};

const DOUBLE = {
  "two-orange-green": {
    layers: [
      { gradient: { dark: "#FFFFFF", light: "#FF512F" }, multiplyColor: null, offset: [0, 0], alpha: 0.95, negative: true },
      { gradient: { dark: "#5E8C4A", light: "#FFFFFF" }, multiplyColor: null, offset: [4, 4], blend: "multiply", alpha: 0.8 },
    ],
    hoverOffset: [14, 14],
  },
  "two-magenta-teal": {
    layers: [
      { gradient: { dark: "#D23A6A", light: "#FFFFFF" }, multiplyColor: null, offset: [0, 0], alpha: 0.95 },
      { gradient: { dark: "#2E8C8C", light: "#FFFFFF" }, multiplyColor: null, offset: [4, 4], blend: "multiply", alpha: 0.8 },
    ],
    hoverOffset: [14, 14],
  },
  "two-blue-gold": {
    layers: [
      { gradient: { dark: "#3556C4", light: "#FFFFFF" }, multiplyColor: null, offset: [0, 0], alpha: 0.95 },
      { gradient: { dark: "#C79A2A", light: "#FFFFFF" }, multiplyColor: null, offset: [4, 4], blend: "multiply", alpha: 0.8 },
    ],
    hoverOffset: [14, 14],
  },
};

/** Bake the row images' static and two-layer hover treatments. */
async function setupPins() {
  if (!halftone || !halftone.supported) return;
  const jobs = [];
  for (const img of document.querySelectorAll("img[data-fx]")) {
    const key = img.dataset.fx;
    const config = SINGLE[key] ?? DOUBLE[key];
    if (!config) continue;
    jobs.push(halftone.pin(img, config));
    if (DOUBLE[key]) {
      const base = config.layers[config.layers.length - 1].offset;
      img.addEventListener("pointerenter", () => {
        halftone.shiftPin(img, config.hoverOffset, 240);
      });
      img.addEventListener("pointerleave", () => {
        halftone.shiftPin(img, base, 260);
      });
    }
  }
  await Promise.all(jobs);
  halftone.sync();
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

const initialPage = pageFromHash();
applyPage(initialPage, { push: false, focus: false });
window.history.replaceState({ page: initialPage }, "", `#${initialPage}`);

void start();
