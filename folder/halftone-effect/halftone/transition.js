import { Sprite, Texture } from "pixi.js";
import { captureViewport } from "./capture.js";
import { normalizeParams } from "./params.js";
import { Surface } from "./surface.js";
import {
  cancelIdle,
  disposeTexture,
  easeInOutCubic,
  easeOutCubic,
  idle,
} from "./utils.js";

const OUT_HOLD_MS = 1400;
const INCOMING_DELAY_MS = 240;
const SWAP_MS = 120;
const CROSSFADE_MS = 1400;
const RESOLVE_MS = 700;
const INCOMING_TIMEOUT_MS = 1500;

/** Snapshot page transition: outgoing hold, incoming crossfade, cache. */
export class TransitionController {
  constructor({
    overlay,
    getParams,
    getTransitionParams,
    reducedMotion,
    options,
  }) {
    this.overlay = overlay;
    this.getParams = getParams;
    this.getTransitionParams = getTransitionParams;
    this.reducedMotion = reducedMotion;
    this.options = options;

    this._snapshot = null;
    this._snapshotScrollY = 0;
    this._idleHandle = null;
    this._captureGeneration = 0;
    this._transitioning = false;
    this.lastTransition = null;
    this.speed = 1;
  }

  get transitionSpeed() {
    return this.speed;
  }

  setSpeed(value) {
    this.speed = Math.min(3, Math.max(0.4, Number(value) || 1));
    return this.speed;
  }

  get busy() {
    return this._transitioning;
  }

  get snapshotCached() {
    return this._snapshot != null;
  }

  /** Resolve html-to-image options from the instance config. */
  _captureOptions() {
    const capture = this.options.capture || {};
    return {
      pixelRatio: capture.pixelRatio ?? 1.25,
      maxDimension: capture.maxDimension ?? 2200,
      backgroundColor: capture.backgroundColor ?? null,
    };
  }

  /** Snapshot the current viewport; returns null on failure. */
  async _capture() {
    const patternLayer = this.overlay.patternLayer;
    const wasVisible = patternLayer?.visible ?? false;
    if (patternLayer) patternLayer.visible = true;
    try {
      const bitmap = await captureViewport({
        ...this._captureOptions(),
        revealHidden: false,
      });
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      bitmap.close?.();

      // html-to-image cannot see the Pixi canvas; composite its pattern layer
      // with the same multiply the live page uses.
      const pattern = this.overlay.extractPattern();
      if (pattern) {
        context.save();
        context.globalCompositeOperation = 'multiply';
        context.drawImage(pattern, 0, 0, canvas.width, canvas.height);
        context.restore();
      }

      return { bitmap: canvas, width: canvas.width, height: canvas.height };
    } catch (error) {
      this.overlay.warn("snapshot", error);
      return null;
    } finally {
      if (patternLayer) patternLayer.visible = wasVisible;
    }
  }

  /** Capture and cache the outgoing page snapshot for the next run. */
  async captureSnapshot() {
    if (
      !this.overlay.supported ||
      this.overlay.destroyed ||
      this._snapshot ||
      this._transitioning
    )
      return;
    const generation = this._captureGeneration;
    const snapshot = await this._capture();
    if (!snapshot) return;
    if (
      this.overlay.destroyed ||
      generation !== this._captureGeneration ||
      this._snapshot ||
      this._transitioning
    ) {
      snapshot.bitmap?.close?.();
      return;
    }
    this._snapshot = snapshot;
    this._snapshotScrollY = window.scrollY;
  }

  /** Drop the cached outgoing snapshot. */
  invalidateSnapshot() {
    this._invalidateSnapshot();
  }

  _invalidateSnapshot() {
    this._captureGeneration += 1;
    if (!this._snapshot) return;
    this._snapshot.bitmap?.close?.();
    this._snapshot = null;
  }

  /** Invalidate the snapshot when the page has scrolled since capture. */
  onScroll() {
    if (
      this._snapshot &&
      Math.abs(window.scrollY - this._snapshotScrollY) > 2
    ) {
      this._invalidateSnapshot();
    }
  }

  /** Schedule a background snapshot so the first transition is fast. */
  _scheduleIdle() {
    if (
      this.overlay.supported &&
      !this.overlay.destroyed &&
      this._idleHandle == null &&
      !this._snapshot
    ) {
      this._idleHandle = idle(() => {
        this._idleHandle = null;
        if (this.overlay.destroyed || this._snapshot || this._transitioning)
          return;
        void this.captureSnapshot();
      });
    }
  }

  /** Capture, halftone and crossfade the outgoing/incoming pages. */
  async run(update, options = {}) {
    if (typeof update !== "function") return false;
    if (!this.overlay.supported || this.overlay.destroyed) {
      await update();
      return false;
    }
    if (this._transitioning) return false;

    if (this.reducedMotion) {
      await update();
      this._invalidateSnapshot();
      this._scheduleIdle();
      return true;
    }

    this._transitioning = true;
    const speed = this.speed;
    const ms = (value) => Math.max(0, Math.round(value / speed));
    this.overlay.setCanvasBlend('normal');
    if (this.overlay.patternLayer) this.overlay.patternLayer.visible = false;
    const debugStart = performance.now();
    let debugIncomingMs = -1;
    let debugIncomingStarted = 0;

    const resolve = (value) => normalizeParams(value ?? this.getTransitionParams(), this.getParams());
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const outgoingParams = { ...resolve(options.outgoingParams ?? options.params), designWidth: width, designHeight: height };
    const incomingParams = { ...resolve(options.incomingParams ?? options.params), designWidth: width, designHeight: height };
    const gradientStops = outgoingParams.gradient?.stops;
    const lightStop = gradientStops?.length
      ? gradientStops[gradientStops.length - 1].color.slice(0, 3)
      : outgoingParams.colorMode === 1 ? [0, 0, 0] : [1, 1, 1];
    const paper = lightStop;
    const paperInt =
      (Math.round(paper[0] * 255) << 16) |
      (Math.round(paper[1] * 255) << 8) |
      Math.round(paper[2] * 255);
    const background = this.options.backingColor ?? paperInt;

    let outgoing = options.outgoing ?? this._snapshot;
    this._snapshot = null;
    let incoming = null;
    let outTexture = null;
    let inTexture = null;
    let realSurface = null;
    let outRecord = null;
    let inRecord = null;
    let backing = null;
    let incomingPromise = null;
    let updated = false;

    try {
      if (!outgoing) outgoing = await this._capture();
      if (!outgoing) {
        await update();
        updated = true;
        return false;
      }

      outTexture = this.overlay.makeTexture(outgoing.bitmap);
      const outBlur = this.overlay.acquireBlur(
        outTexture,
        width,
        height,
        outgoingParams.dotSize,
        outgoingParams.renderScale,
      );
      const outSurface = new Surface({
        width,
        height,
        resolution: this.overlay.transitionResolution,
        blurEntry: outBlur,
        inputTexture: outTexture,
        params: outgoingParams,
      });
      outRecord = this.overlay.trackSurface(outSurface, outBlur);
      outSurface.setReveal(1);
      outSurface.setDotScale(outgoingParams.dotScale);

      backing = new Sprite(Texture.WHITE);
      backing.width = width;
      backing.height = height;
      backing.tint = background;

      this.overlay.transitionLayer.addChild(backing, outSurface.sprite);
      this.overlay.requestRender();
      await this.overlay.nextPaint();
      await this.overlay.nextPaint();
      if (this.overlay.destroyed) return false;

      try {
        options.onOutReady?.();
      } catch (error) {
        this.overlay.warn('out-ready', error);
      }

      await this.overlay.wait(ms(OUT_HOLD_MS));
      await this.overlay.wait(ms(SWAP_MS));
      if (this.overlay.destroyed) return false;

      try {
        await update();
      } catch (error) {
        this.overlay.warn("update", error);
      }
      updated = true;

      // Pinning the incoming page re-applies its pattern blend. The transition
      // surfaces must stay in normal blend mode or the incoming page bleeds
      // through the outgoing halftone.
      this.overlay.setCanvasBlend('normal');

      debugIncomingStarted = performance.now();
      incomingPromise = (async () => {
        if (this.overlay.destroyed) return null;
        return this._capture();
      })();

      await this.overlay.wait(ms(INCOMING_DELAY_MS));
      if (this.overlay.destroyed) return false;

      incoming = await Promise.race([
        incomingPromise,
        this.overlay.wait(ms(INCOMING_TIMEOUT_MS)).then(() => null),
      ]);
      debugIncomingMs = incoming
        ? performance.now() - debugIncomingStarted
        : -1;

      incomingPromise
        .then((late) => {
          if (late && late !== incoming) late.bitmap?.close?.();
        })
        .catch(() => {});

      if (this.overlay.destroyed) return false;

      if (incoming) {
        inTexture = this.overlay.makeTexture(incoming.bitmap);
        const inBlur = this.overlay.acquireBlur(
          inTexture,
          width,
          height,
          incomingParams.dotSize,
          incomingParams.renderScale,
        );
        const inSurface = new Surface({
          width,
          height,
          resolution: this.overlay.transitionResolution,
          blurEntry: inBlur,
          inputTexture: inTexture,
          params: incomingParams,
        });
        inRecord = this.overlay.trackSurface(inSurface, inBlur);
        inSurface.setReveal(0);
        inSurface.setDotScale(incomingParams.dotScale);
        this.overlay.transitionLayer.addChildAt(inSurface.sprite, 1);

        // The incoming page snapshot already contains the live pattern layer.
        // Fade that exact image over the halftone before swapping to the real
        // page, so the resolve is not a flat-paper frame.
        realSurface = new Sprite(inTexture);
        realSurface.width = width;
        realSurface.height = height;
        realSurface.alpha = 0;
        this.overlay.transitionLayer.addChild(realSurface);
        this.overlay.requestRender();

        this.overlay.tween({
          from: 1,
          to: 0,
          duration: ms(CROSSFADE_MS),
          ease: easeInOutCubic,
          onUpdate: (value) => {
            if (!outRecord.destroyed) outSurface.setReveal(value);
          },
        });
        this.overlay.tween({
          from: 0,
          to: 1,
          duration: ms(CROSSFADE_MS),
          ease: easeInOutCubic,
          onUpdate: (value) => {
            if (!inRecord.destroyed) inSurface.setReveal(value);
          },
        });

        await this.overlay.wait(ms(CROSSFADE_MS));
        if (this.overlay.destroyed) return false;

        this.overlay.tween({
          from: 1,
          to: 0,
          duration: ms(RESOLVE_MS),
          ease: easeOutCubic,
          onUpdate: (value) => {
            if (!inRecord.destroyed) inSurface.setReveal(value);
            if (backing && !backing.destroyed) backing.alpha = value;
          },
        });
        this.overlay.tween({
          from: 0,
          to: 1,
          duration: ms(RESOLVE_MS),
          ease: easeOutCubic,
          onUpdate: (value) => {
            if (realSurface && !realSurface.destroyed) realSurface.alpha = value;
          },
        });
        await this.overlay.wait(ms(RESOLVE_MS));
        if (this.overlay.destroyed) return false;
      } else {
        await this.overlay.wait(ms(280));
        if (this.overlay.destroyed) return false;
        this.overlay.tween({
          from: outSurface.reveal,
          to: 0,
          duration: ms(320),
          ease: easeInOutCubic,
          onUpdate: (value) => {
            if (!outRecord.destroyed) outSurface.setReveal(value);
            if (backing && !backing.destroyed) backing.alpha = value;
          },
        });
        await this.overlay.wait(ms(320));
      }

      return true;
    } catch (error) {
      this.overlay.warn("transition", error);
      if (!updated) {
        try {
          await update();
        } catch (updateError) {
          this.overlay.warn("update", updateError);
        }
      }
      return false;
    } finally {
      if (incoming && !this.overlay.destroyed) {
        this._snapshot = incoming;
        this._snapshotScrollY = window.scrollY;
      } else if (incoming) {
        incoming.bitmap?.close?.();
      }
      realSurface?.destroy();
      disposeTexture(outTexture);
      disposeTexture(inTexture);
      outgoing?.bitmap?.close?.();
      this.overlay.destroyRecord(outRecord);
      this.overlay.destroyRecord(inRecord);
      if (backing) {
        backing.removeFromParent();
        backing.destroy();
      }
      this.lastTransition = {
        mode: "snapshot",
        incoming: !!incoming,
        incomingMs: debugIncomingMs,
        totalMs: performance.now() - debugStart,
      };
      this._transitioning = false;
      this.overlay.setCanvasBlend('multiply');
      if (this.overlay.patternLayer) this.overlay.patternLayer.visible = true;
      this.overlay.requestRender();
      this.overlay.flushResize();
      this._scheduleIdle();
    }
  }

  /** Cancel the idle capture and release the cached snapshot. */
  destroy() {
    cancelIdle(this._idleHandle);
    this._idleHandle = null;
    this._invalidateSnapshot();
    this._transitioning = false;
  }
}
