const DB_NAME = 'halftone-page-transition';
const STORE = 'snapshots';
const KEY = 'pending';
const MARKER = 'halftone:page';
const BOOT = 'halftone:boot';
const TTL = 15000;

const openDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const run = async (mode, callback) => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const request = callback(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    db.close();
    throw error;
  }
};

export async function savePending(dataUrl) {
  const payload = { id: crypto.randomUUID(), png: dataUrl, at: Date.now() };
  await run('readwrite', (store) => store.put(payload, KEY));
  try {
    // Synchronously available to the incoming page's first paint.
    sessionStorage.setItem(BOOT, dataUrl);
  } catch {
    /* quota; the boot falls back to the IndexedDB image */
  }
  sessionStorage.setItem(MARKER, JSON.stringify({ id: payload.id, at: payload.at }));
}

export async function loadPending() {
  let marker = null;
  try {
    marker = JSON.parse(sessionStorage.getItem(MARKER) || 'null');
  } catch {
    marker = null;
  }
  if (!marker) return null;
  if (Date.now() - marker.at > TTL) {
    clearPending();
    return null;
  }
  try {
    const payload = await run('readonly', (store) => store.get(KEY));
    if (!payload || payload.id !== marker.id) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function clearPending() {
  sessionStorage.removeItem(MARKER);
  sessionStorage.removeItem(BOOT);
  try {
    await run('readwrite', (store) => store.delete(KEY));
  } catch {
    /* storage unavailable */
  }
  finishBoot();
}

export function hasPendingMarker() {
  return Boolean(sessionStorage.getItem(MARKER));
}

export function beginBoot() {
  document.documentElement.classList.add('halftone-booting');
  const boot = document.querySelector('.page-boot');
  if (boot) {
    boot.style.transition = 'none';
    boot.style.opacity = '1';
  }
}

export function setBootImage(dataUrl) {
  const image = document.getElementById('page-boot-image');
  if (!image) return;
  image.src = dataUrl;
  beginBoot();
}

export function finishBoot() {
  document.documentElement.classList.remove('halftone-booting');
  const boot = document.querySelector('.page-boot');
  if (boot) {
    boot.style.transition = '';
    boot.style.opacity = '';
  }
  const image = document.getElementById('page-boot-image');
  if (image) image.removeAttribute('src');
}

export async function snapshotPage() {
  const { captureViewport } = await import('./capture.js');
  const shot = await captureViewport({ pixelRatio: 0.75, maxDimension: 1600, revealHidden: false });
  const canvas = document.createElement('canvas');
  canvas.width = shot.width;
  canvas.height = shot.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(shot, 0, 0);

  // html-to-image excludes the Pixi canvas; composite the rendered pattern
  // layer back on with the page's multiply.
  const pattern = window.__halftone?.extractPattern?.();
  if (pattern) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(pattern, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  shot.close?.();
  return canvas.toDataURL('image/png');
}

export async function decodeSnapshot(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  return { bitmap, width: bitmap.width, height: bitmap.height };
}
