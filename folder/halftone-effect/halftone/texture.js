import { Texture, TextureSource } from 'pixi.js';
import { clamp, disposeTexture, parseObjectPosition } from './utils.js';

const MAX_TEXTURE = 2048;

let cache = new WeakMap();
let liveEntries = new Set();

/** Release every cached image texture. */
export function invalidateTextures() {
  for (const entry of liveEntries) {
    disposeTexture(entry.texture);
    entry.bitmap?.close?.();
  }
  liveEntries.clear();
  cache = new WeakMap();
}

function makeTexture(resource, width, height) {
  const source = TextureSource.from({ resource, width, height, resolution: 1 });
  return new Texture({ source });
}

/** Resolve the source crop and drawn rect for object-fit and position. */
export function computeFit(img, rect) {
  const naturalWidth = img.naturalWidth || img.width || 1;
  const naturalHeight = img.naturalHeight || img.height || 1;
  const boxWidth = Math.max(1, rect.width);
  const boxHeight = Math.max(1, rect.height);
  const style = getComputedStyle(img);
  const objectFit = style.objectFit || 'fill';
  const [positionX, positionY] = parseObjectPosition(style.objectPosition);

  let sx = 0;
  let sy = 0;
  let sw = naturalWidth;
  let sh = naturalHeight;
  let dx = 0;
  let dy = 0;
  let dw = boxWidth;
  let dh = boxHeight;

  if (objectFit === 'cover') {
    if (boxWidth / boxHeight > naturalWidth / naturalHeight) {
      sh = naturalWidth * (boxHeight / boxWidth);
    } else {
      sw = naturalHeight * (boxWidth / boxHeight);
    }
    sx = (naturalWidth - sw) * positionX;
    sy = (naturalHeight - sh) * positionY;
  } else if (objectFit === 'contain' || objectFit === 'scale-down') {
    let scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
    if (objectFit === 'scale-down') scale = Math.min(scale, 1);
    dw = naturalWidth * scale;
    dh = naturalHeight * scale;
    dx = (boxWidth - dw) * positionX;
    dy = (boxHeight - dh) * positionY;
  } else if (objectFit === 'none') {
    dw = naturalWidth;
    dh = naturalHeight;
    dx = (boxWidth - dw) * positionX;
    dy = (boxHeight - dh) * positionY;
  }

  return { sx, sy, sw, sh, dx, dy, dw, dh, objectFit };
}

function canvasCrop(img, fit, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(img, fit.sx, fit.sy, fit.sw, fit.sh, 0, 0, width, height);
  return canvas;
}

/** Crop/downscale an image once and cache the texture used to bake blurs. */
export async function prepareImage(img) {
  if (!img || !img.naturalWidth) return null;
  const rect = img.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const fit = computeFit(img, rect);
  const targetWidth = clamp(Math.round(fit.dw * dpr), 1, MAX_TEXTURE);
  const targetHeight = clamp(Math.round(fit.dh * dpr), 1, MAX_TEXTURE);
  const key = [
    Math.round(rect.width),
    Math.round(rect.height),
    Math.round(fit.sx),
    Math.round(fit.sy),
    Math.round(fit.sw),
    Math.round(fit.sh),
    targetWidth,
    targetHeight,
  ].join('|');

  const cached = cache.get(img);
  if (cached && cached.key === key) return cached;
  if (cached) {
    liveEntries.delete(cached);
    disposeTexture(cached.texture);
    cached.bitmap?.close?.();
  }

  let bitmap = null;
  let texture;

  if (typeof createImageBitmap === 'function') {
    try {
      bitmap = await createImageBitmap(img, fit.sx, fit.sy, fit.sw, fit.sh, {
        resizeWidth: targetWidth,
        resizeHeight: targetHeight,
        resizeQuality: 'medium',
      });
      texture = makeTexture(bitmap, targetWidth, targetHeight);
    } catch {
      bitmap = null;
    }
  }

  if (!texture) {
    const canvas = canvasCrop(img, fit, targetWidth, targetHeight);
    texture = makeTexture(canvas, targetWidth, targetHeight);
  }

  const entry = {
    key,
    texture,
    bitmap,
    fit,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    width: targetWidth,
    height: targetHeight,
  };
  cache.set(img, entry);
  liveEntries.add(entry);
  return entry;
}
