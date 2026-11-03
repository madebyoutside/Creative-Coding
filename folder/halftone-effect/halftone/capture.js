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
