import { Container, RenderTexture, RendererType, Texture, TextureSource, autoDetectRenderer } from 'pixi.js';
import { BlurCache, bakeBlur } from './surface.js';
import { invalidateTextures, prepareImage } from './texture.js';
import { Tween, nextFrame } from './utils.js';

/** Owns the Pixi renderer, fixed canvas, layers, ticker and overlay lifecycle. */
export class Overlay {
  constructor(options = {}) {
    this.options = options;
    this.hoverResolution = options.hoverResolution ?? Math.min(window.devicePixelRatio || 1, 2);
    this.transitionResolution = options.transitionResolution ?? Math.min(window.devicePixelRatio || 1, 1.5);

    this.supported = false;
    this.backend = null;
    this.destroyed = false;

    this.stage = null;
    this.patternLayer = null;
    this.hoverLayer = null;
    this.transitionLayer = null;
    this.renderer = null;
    this.canvas = null;

    this._tweens = [];
    this._timers = new Set();
    this._raf = null;
    this._dirty = false;
    this._renderCount = 0;

    this._surfaces = new Set();
    this._blurCache = null;
    this._preparePromises = new WeakMap();
    this._warnings = new Set();

    this._resizeTimer = null;
    this._pendingResize = false;
    this.shouldDeferResize = null;
    this.onResize = null;
    this.onScroll = null;
  }

  get active() {
    return this._tweens.length > 0;
  }

  get renderCount() {
    return this._renderCount;
  }

/** Start the renderer; returns false when no GPU backend is available. */
  async init() {
    const canvas = document.createElement('canvas');
    canvas.className = 'halftone-canvas';
    canvas.setAttribute('data-halftone-ignore', '');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = [
      'position:fixed',
      'inset:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      `z-index:${this.options.zIndex ?? 9999}`,
    ].join(';');
    this.canvas = canvas;

    try {
      this.renderer = await autoDetectRenderer({
        preference: this.options.preference ?? ['webgpu', 'webgl'],
        canvas,
        width: Math.max(1, window.innerWidth),
        height: Math.max(1, window.innerHeight),
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        backgroundAlpha: 0,
        antialias: false,
        powerPreference: 'high-performance',
      });
      this.backend = this.renderer.type === RendererType.WEBGPU ? 'webgpu' : 'webgl';
      this.supported = true;
      document.body.appendChild(canvas);

      this.stage = new Container();
      this.patternLayer = new Container();
      this.hoverLayer = new Container();
      this.transitionLayer = new Container();
      this.stage.addChild(this.patternLayer, this.hoverLayer, this.transitionLayer);
      this._blurCache = new BlurCache(this.renderer);

      window.addEventListener('resize', this._handleResize, { passive: true });
      window.addEventListener('scroll', this._handleScroll, { passive: true, capture: true });
      document.addEventListener('visibilitychange', this._handleVisibility);

      this.requestRender();
    } catch (error) {
      this.supported = false;
      this.report(error);
      this.canvas?.remove();
      this.renderer = null;
    }

    return this.supported;
  }

/** Report a renderer failure without breaking the page. */
  report(error) {
    console.warn('[halftone] could not start the GPU renderer', error);
    try {
      this.options.onError?.(error);
    } catch {
      /* ignore user handler */
    }
    window.dispatchEvent(new CustomEvent('halftone:unsupported', { detail: { error } }));
  }

/** Log a feature failure once per key. */
  warn(key, error) {
    if (this._warnings.has(key)) return;
    this._warnings.add(key);
    console.warn(`[halftone] ${key} failed`, error);
  }

  _schedule() {
    if (this._raf != null || this.destroyed) return;
    this._raf = requestAnimationFrame(this._tick);
  }

/** Set how the pattern canvas composites with the page. */
  setCanvasBlend(mode = 'multiply', opacity = 1) {
    if (!this.canvas) return;
    this.canvas.style.mixBlendMode = mode || 'normal';
    this.canvas.style.opacity = String(opacity ?? 1);
  }

/** Render the live pattern layer to a canvas for transition snapshots. */
  extractPattern() {
    if (!this.renderer || !this.patternLayer || this.destroyed) return null;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const target = RenderTexture.create({ width, height, resolution: 1 });
    try {
      this.renderer.render({ container: this.patternLayer, target, clear: true });
      return this.renderer.extract.canvas(target);
    } catch {
      return null;
    } finally {
      target.destroy(true);
    }
  }

/** Mark the overlay dirty and schedule the next frame. */
  requestRender() {
    this._dirty = true;
    this._schedule();
  }

  _tick = (now) => {
    this._raf = null;
    if (this.destroyed) return;
    for (let i = this._tweens.length - 1; i >= 0; i -= 1) {
      if (this._tweens[i].step(now)) this._tweens.splice(i, 1);
    }
    this._renderFrame();
    if (this._tweens.length > 0 || this._dirty) {
      this._dirty = false;
      this._schedule();
    }
  };

  _renderFrame() {
    if (!this.renderer) return;
    this.renderer.render({ container: this.stage, clear: true });
    this._renderCount += 1;
  }

/** Start a tween on the overlay ticker. */
  tween(spec) {
    const tween = new Tween(spec);
    this._tweens.push(tween);
    this._schedule();
    return tween;
  }

  cancelTween(tween) {
    if (!tween) return;
    tween.done = true;
    const index = this._tweens.indexOf(tween);
    if (index !== -1) this._tweens.splice(index, 1);
  }

  cancelTweens(list) {
    for (const tween of list || []) this.cancelTween(tween);
  }

/** Resolve after ms, or when the overlay is destroyed. */
  wait(ms) {
    return new Promise((resolve) => {
      const entry = { timer: 0, resolve };
      entry.timer = window.setTimeout(() => {
        this._timers.delete(entry);
        resolve();
      }, ms);
      this._timers.add(entry);
    });
  }

/** Resolve after the next painted frame, with a timeout fallback. */
  nextPaint() {
    return Promise.race([nextFrame(), this.wait(80)]);
  }

  _handleResize = () => {
    if (this._resizeTimer) window.clearTimeout(this._resizeTimer);
    this._resizeTimer = window.setTimeout(() => {
      this._resizeTimer = null;
      this.resize();
    }, 150);
  };

  _handleScroll = () => {
    this.onScroll?.();
  };

  _handleVisibility = () => {
    if (document.hidden) {
      if (this._raf != null) {
        cancelAnimationFrame(this._raf);
        this._raf = null;
      }
      return;
    }
    if (this._tweens.length > 0 || this._dirty) this._schedule();
  };

/** Resize the renderer and rebuild targets; defers during transitions. */
  resize() {
    if (!this.supported || this.destroyed) return;
    if (this.shouldDeferResize?.()) {
      this._pendingResize = true;
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(Math.max(1, window.innerWidth), Math.max(1, window.innerHeight), dpr);
    this.hoverResolution = this.options.hoverResolution ?? Math.min(dpr, 2);
    this.transitionResolution = this.options.transitionResolution ?? Math.min(dpr, 1.5);

    for (const record of [...this._surfaces]) this.destroyRecord(record);
    invalidateTextures();
    this._blurCache?.destroy();
    this._preparePromises = new WeakMap();

    this.onResize?.();
    this.requestRender();
  }

/** Apply a resize that was deferred while a transition was running. */
  flushResize() {
    if (!this._pendingResize) return;
    this._pendingResize = false;
    this.resize();
  }

/** Decode and cache an image entry for hover and pin surfaces. */
  prepare(element) {
    if (!this.supported || this.destroyed || !element || !element.isConnected) {
      return Promise.resolve(null);
    }
    let promise = this._preparePromises.get(element);
    if (!promise) {
      promise = (async () => {
        try {
          if (!element.complete && element.decode) await element.decode().catch(() => {});
          return await prepareImage(element);
        } catch {
          return null;
        } finally {
          this._preparePromises.delete(element);
        }
      })();
      this._preparePromises.set(element, promise);
    }
    return promise;
  }

/** Acquire a shared blurred texture for the given dot pitch. */
  acquireBlur(texture, designWidth, designHeight, dotSize, renderScale = 2) {
    const snapped = Math.max(0.5, Math.round(dotSize * 2) / 2);
    const key = `${texture.uid}|${Math.round(designWidth)}x${Math.round(designHeight)}|${snapped}|${renderScale}`;
    return this._blurCache.acquire(key, () =>
      bakeBlur(this.renderer, texture, designWidth, designHeight, snapped, renderScale),
    );
  }

/** Track a surface so resize/destroy can release it. */
  trackSurface(surface, blurEntry) {
    const record = { surface, blurEntry, destroyed: false };
    this._surfaces.add(record);
    return record;
  }

/** Release a tracked surface and its shared blur. */
  destroyRecord(record) {
    if (!record || record.destroyed) return;
    record.destroyed = true;
    this._surfaces.delete(record);
    record.surface.sprite.removeFromParent();
    record.surface.destroy();
    this._blurCache?.release(record.blurEntry);
  }

/** Wrap a bitmap or canvas in a Pixi texture for the transition. */
  makeTexture(resource) {
    const width = resource.width;
    const height = resource.height;
    const source = TextureSource.from({ resource, width, height, resolution: 1 });
    return new Texture({ source });
  }

/** Release the renderer, canvas, textures, tweens and listeners. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    this._cancelAllTweens();

    if (this._resizeTimer) {
      window.clearTimeout(this._resizeTimer);
      this._resizeTimer = null;
    }
    if (this._raf != null) cancelAnimationFrame(this._raf);
    this._raf = null;

    for (const entry of this._timers) {
      window.clearTimeout(entry.timer);
      entry.resolve();
    }
    this._timers.clear();

    for (const record of [...this._surfaces]) this.destroyRecord(record);
    this._blurCache?.destroy();
    this._blurCache = null;

    window.removeEventListener('resize', this._handleResize);
    window.removeEventListener('scroll', this._handleScroll, true);
    document.removeEventListener('visibilitychange', this._handleVisibility);

    invalidateTextures();

    try {
      this.renderer?.destroy();
    } catch {
      /* the device may already be gone */
    }
    this.renderer = null;
    this.stage = null;
    this.patternLayer = null;
    this.hoverLayer = null;
    this.transitionLayer = null;
    this.onResize = null;
    this.onScroll = null;
    this.shouldDeferResize = null;
    this.canvas?.remove();
    this.canvas = null;
  }

  _cancelAllTweens() {
    for (const tween of this._tweens) tween.done = true;
    this._tweens.length = 0;
  }
}
