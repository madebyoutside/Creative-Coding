import { HoverController } from './hover.js';
import { Overlay } from './overlay.js';
import { normalizeParams } from './params.js';
import { PinController } from './pins.js';
import { TransitionController } from './transition.js';

/** Public facade over the overlay, hover, pin and transition controllers. */
export class Halftone {
/** Create and start a halftone instance. */
  static async create(options = {}) {
    const instance = new Halftone(options);
    await instance._init();
    return instance;
  }

  constructor(options = {}) {
    this.options = options;
    this.params = normalizeParams(options.params);
    this.transitionParams = normalizeParams(options.transitionParams, this.params);
    this._reducedMotion =
      options.reducedMotion === 'always' ||
      (options.reducedMotion !== 'never' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true);

    this.overlay = new Overlay(options);
    this.hoverController = null;
    this.pinController = null;
    this.transitionController = null;
  }

  get supported() {
    return this.overlay.supported;
  }

  get backend() {
    return this.overlay.backend;
  }

  get canvas() {
    return this.overlay.canvas;
  }

  get destroyed() {
    return this.overlay.destroyed;
  }

  get active() {
    return this.overlay.active || (this.transitionController?.busy ?? false);
  }

  get busy() {
    return this.transitionController?.busy ?? false;
  }

  get renderCount() {
    return this.overlay.renderCount;
  }

  get snapshotCached() {
    return this.transitionController?.snapshotCached ?? false;
  }

  get lastTransition() {
    return this.transitionController?.lastTransition ?? null;
  }

/** Start the overlay and wire the controllers; false without a GPU backend. */
  async _init() {
    const ok = await this.overlay.init();
    if (!ok) return false;

    this.hoverController = new HoverController({
      overlay: this.overlay,
      getParams: () => this.params,
      isPinned: (element) => this.pinController?.has(element) ?? false,
      isBusy: () => this.transitionController?.busy ?? false,
      reducedMotion: this._reducedMotion,
    });
    this.pinController = new PinController({
      overlay: this.overlay,
      getParams: () => this.params,
    });
    this.transitionController = new TransitionController({
      overlay: this.overlay,
      getParams: () => this.params,
      getTransitionParams: () => this.transitionParams,
      reducedMotion: this._reducedMotion,
      options: this.options,
    });

    this.overlay.shouldDeferResize = () => this.transitionController.busy;
    this.overlay.onResize = () => {
      this.hoverController.handleResize();
      this.pinController.sync();
      this.transitionController.invalidateSnapshot();
    };
    this.overlay.onScroll = () => {
      this.transitionController.onScroll();
      this.hoverController.syncRect();
      this.pinController.sync();
    };
    return true;
  }

/** Attach the single-image hover effect to image elements. */
  attachHover(targets) {
    this.hoverController?.attach(targets);
  }

/** Remove hover listeners and release the active hover surface. */
  detachHover() {
    this.hoverController?.detach();
  }

/** Run the hover effect for one image. */
  hover(element) {
    return this.hoverController?.hover(element);
  }

/** Fade out the active hover effect. */
  unhover() {
    this.hoverController?.unhover();
  }

/** Decode and cache an image for hover/pin use. */
  prepare(element) {
    return this.overlay.prepare(element);
  }

/** Decode the attached hover images ahead of time. */
  prewarm() {
    return this.hoverController?.prewarm();
  }

/** Read the current page-transition speed multiplier. */
  get transitionSpeed() {
    return this.transitionController?.transitionSpeed ?? 1;
  }

/** Set the page-transition speed multiplier (higher is faster). */
  setTransitionSpeed(value) {
    return this.transitionController?.setSpeed(value) ?? 1;
  }

/** Update the base params and sync the active hover surface. */
  setParams(partial) {
    this.transitionController?.invalidateSnapshot();
    this.params = normalizeParams(partial, this.params);
    this.hoverController?.applyParams();
    if (this.supported && !this.busy) void this.pinController?.refreshAll();
    return this.params;
  }

/** Bake one or more halftone layers over an image. */
  pin(element, options) {
    return this.pinController?.pin(element, options);
  }

/** Remove all live pinned patterns. */
  unpinAll() {
    this.pinController?.unpinAll();
  }

/** Replace a pinned image's complete config and rebuild it. */
  updatePin(element, options = {}) {
    if (this.overlay.destroyed || !this.supported || !element) return Promise.resolve(null);
    if (this.transitionController?.busy) return Promise.resolve(null);
    this.transitionController?.invalidateSnapshot();
    return this.pinController.update(element, options);
  }

/** Fade a pinned image between the full pattern (1) and the original (0). */
  setPinReveal(element, value) {
    return this.pinController?.setReveal(element, value) ?? false;
  }

/** Read the live config for a pinned image. */
  getPinConfig(element) {
    return this.pinController?.get(element)?.options ?? null;
  }

/** Animate a pinned image's top layer offset. */
  shiftPin(element, offset, duration) {
    this.pinController?.shiftPin(element, offset, duration);
  }

/** Reposition baked pins and the active hover after layout changes. */
  sync() {
    if (!this.supported || this.destroyed) return;
    this.pinController?.sync();
    this.hoverController?.syncRect();
    this.overlay.requestRender();
  }

/** Snapshot the page and crossfade into the next view. */
  transition(update, options = {}) {
    if (typeof update !== 'function') return false;
    if (!this.supported || this.destroyed) {
      update();
      return false;
    }
    if (this.busy) return false;
    this.hoverController?.cancel();
    return this.transitionController.run(update, options);
  }

/** Canvas of the live pattern layer, including paper/photo compositing. */
  extractPattern() {
    return this.overlay.extractPattern?.() ?? null;
  }

/** Prewarm the cached outgoing transition snapshot. */
  captureSnapshot() {
    return this.transitionController?.captureSnapshot();
  }

/** Drop the cached outgoing transition snapshot. */
  invalidateSnapshot() {
    this.transitionController?.invalidateSnapshot();
  }

/** Release the renderer, overlays, tweens and listeners. */
  destroy() {
    if (this.destroyed) return;
    this.hoverController?.destroy();
    this.pinController?.destroy();
    this.transitionController?.destroy();
    this.overlay.destroy();
    this.hoverController = null;
    this.pinController = null;
    this.transitionController = null;
  }
}
