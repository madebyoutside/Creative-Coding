let modulePromise = null;
let fontEmbedCSS = null;
let fontEmbedPromise = null;

async function loadHtmlToImage() {
  if (!modulePromise) modulePromise = import('html-to-image');
  return modulePromise;
}

function readableBackground() {
  const value = getComputedStyle(document.body).backgroundColor;
  if (!value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)') return '#ffffff';
  return value;
}

const MARGINS = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
const FIELDS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'OUTPUT']);

const hasText = (element) =>
  FIELDS.has(element.tagName) ||
  [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());

/** Make the clone keep auto margins, font sizes, inner scroll and stuck sticky elements; returns a cleanup. */
function prepareClone() {
  const rules = [];
  const marked = new Map();
  const mark = (element, rule) => {
    if (!marked.has(element)) {
      marked.set(element, String(marked.size));
      element.setAttribute('data-capture', marked.get(element));
    }
    // Clones render inside an SVG foreignObject, so these rules never touch the live page.
    rules.push(`foreignObject [data-capture="${marked.get(element)}"] ${rule}`);
  };

  // html-to-image copies resolved margins, which read as 0 for auto-margined grid and flex items.
  const elements = [...document.body.querySelectorAll('*')];
  for (const element of elements) {
    const map = element.computedStyleMap?.();
    const auto = map ? MARGINS.filter((name) => String(map.get(name)) === 'auto') : [];
    if (auto.length) mark(element, `{ ${auto.map((name) => `${name}: auto !important;`).join(' ')} }`);
    // html-to-image also shrinks every font size by a fraction of a pixel.
    if (hasText(element)) mark(element, `{ font-size: ${getComputedStyle(element).fontSize} !important; }`);
  }

  const scrolled = elements.filter((element) => element.scrollTop || element.scrollLeft);
  for (const element of scrolled) {
    mark(element, `> * { translate: ${-element.scrollLeft}px ${-element.scrollTop}px !important; }`);
  }
  if (scrolled.length) {
    for (const element of elements) {
      if (getComputedStyle(element).position !== 'sticky') continue;
      const stuck = element.getBoundingClientRect();
      const previous = element.style.position;
      element.style.position = 'static';
      const rest = element.getBoundingClientRect();
      element.style.position = previous;
      mark(element, `{ position: relative !important; inset: auto !important; left: ${stuck.left - rest.left}px !important; top: ${stuck.top - rest.top}px !important; }`);
    }
  }
  if (!rules.length) return () => {};

  const style = document.createElement('style');
  style.textContent = rules.join('\n');
  document.body.appendChild(style);
  return () => {
    style.remove();
    for (const element of marked.keys()) element.removeAttribute('data-capture');
  };
}

/** Snapshot the visible page with html-to-image, excluding the overlay canvas. */
export async function captureViewport({
  pixelRatio = 1.25,
  maxDimension = 2200,
  backgroundColor = null,
  revealHidden = true,
} = {}) {
  const htmlToImage = await loadHtmlToImage();
  await document.fonts.ready;

  if (fontEmbedCSS == null) {
    if (!fontEmbedPromise) {
      fontEmbedPromise = (async () => {
        try {
          return await htmlToImage.getFontEmbedCSS(document.body);
        } catch {
          return '';
        }
      })();
    }
    fontEmbedCSS = await fontEmbedPromise;
  }

  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const scale = Math.min(pixelRatio, maxDimension / Math.max(width, height));

  // Pattern-on-colour pins hide their <img>; reveal it for the page snapshot so
  // the transition still captures the photo rather than an empty paper panel.
  const revealed = revealHidden
    ? [...document.images].filter((img) => img.style.visibility === 'hidden')
    : [];
  for (const img of revealed) img.style.visibility = 'visible';

  const restoreClone = prepareClone();
  let canvas;
  try {
    canvas = await htmlToImage.toCanvas(document.body, {
      width,
      height,
      pixelRatio: Math.max(0.5, scale),
      backgroundColor: backgroundColor || readableBackground(),
      fontEmbedCSS,
      filter: (node) => !(node && node.hasAttribute && node.hasAttribute('data-halftone-ignore')),
    });
  } finally {
    restoreClone();
    for (const img of revealed) img.style.visibility = 'hidden';
  }

  if (!canvas) throw new Error('Empty snapshot');

  if (typeof createImageBitmap === 'function') {
    return await createImageBitmap(canvas);
  }
  return canvas;
}

/** Drop the cached embedded font CSS. */
export function invalidateFontCSS() {
  fontEmbedCSS = null;
  fontEmbedPromise = null;
}
