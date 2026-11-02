export const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

export const lerp = (from, to, t) => from + (to - from) * t;

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Resolve on the next animation frame. */
export function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Schedule work when the browser is idle, with a fallback timer. */
export function idle(callback, timeout = 800) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout });
  }
  return window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), Math.min(timeout, 200));
}

/** Cancel a handle returned by idle(). */
export function cancelIdle(handle) {
  if (handle == null) return;
  if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(handle);
  else window.clearTimeout(handle);
}

/** Minimal ticker-driven tween with an optional completion callback. */
export class Tween {
  constructor({ from, to, duration, ease = easeOutCubic, onUpdate, onComplete }) {
    this.from = from;
    this.to = to;
    this.duration = Math.max(1, duration);
    this.ease = ease;
    this.onUpdate = onUpdate;
    this.onComplete = onComplete;
    this.start = null;
    this.done = false;
  }

  step(now) {
    if (this.done) return true;
    if (this.start == null) this.start = now;
    const t = clamp((now - this.start) / this.duration, 0, 1);
    this.onUpdate?.(lerp(this.from, this.to, this.ease(t)));
    if (t >= 1) {
      this.done = true;
      this.onComplete?.();
    }
    return this.done;
  }

  finish() {
    if (this.done) return;
    this.done = true;
    this.onUpdate?.(this.to);
    this.onComplete?.();
  }
}

function keywordPosition(token) {
  const value = String(token).trim().toLowerCase();
  const keywords = { left: 0, top: 0, center: 0.5, right: 1, bottom: 1 };
  return value in keywords ? keywords[value] : null;
}

function percentPosition(token) {
  const value = String(token).trim();
  if (!value.endsWith('%')) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? clamp(n / 100, 0, 1) : null;
}

/** Parse CSS object-position into normalised [x, y]. */
export function parseObjectPosition(value) {
  if (!value) return [0.5, 0.5];
  const parts = String(value).trim().split(/\s+/);
  if (parts.length === 1) {
    const keyword = keywordPosition(parts[0]);
    if (keyword != null) {
      return ['top', 'bottom'].includes(parts[0].toLowerCase()) ? [0.5, keyword] : [keyword, 0.5];
    }
    const percent = percentPosition(parts[0]);
    return percent == null ? [0.5, 0.5] : [percent, 0.5];
  }
  const toValue = (token, fallback) => {
    const keyword = keywordPosition(token);
    if (keyword != null) return keyword;
    const percent = percentPosition(token);
    return percent == null ? fallback : percent;
  };
  return [toValue(parts[0], 0.5), toValue(parts[1], 0.5)];
}

/** Release a texture without tripping Pixi's bound-resource warning. */
export function disposeTexture(texture) {
  if (!texture) return;
  const source = texture.source;
  try {
    source?.unload?.();
  } catch {
  }
  try {
    texture.destroy(false);
  } catch {
  }
  if (source) {
    try {
      source.resource = null;
    } catch {
    }
  }
}

