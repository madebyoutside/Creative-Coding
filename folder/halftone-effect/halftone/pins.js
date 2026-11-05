import { normalizeParams, paramsForElement } from './params.js';
import { Surface } from './surface.js';
import { computeFit } from './texture.js';

const viewportFit = (element) => {
  const rect = element.getBoundingClientRect();
  return { rect, fit: computeFit(element, rect) };
};

/** Draws halftone layers directly onto the single overlay canvas. */
export class PinController {
  constructor({ overlay, getParams }) {
    this.overlay = overlay;
    this.getParams = getParams;
    this._pins = [];
    this._refreshing = new WeakSet();
    this._observer =
      typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.sync()) : null;
  }

/** Whether an image already has a live pattern. */
  has(element) {
    return this._pins.some((pin) => pin.element === element);
  }

/** Create the layer surfaces for one image. */
  async pin(element, options = {}) {
    if (this._refreshing.has(element)) return null;
    return this._pin(element, options);
  }

  async _pin(element, options = {}) {
    if (!this.overlay.supported || this.overlay.destroyed || !element) return null;
    if (this.has(element)) return null;
    const entry = await this.overlay.prepare(element);
    if (!entry || this.overlay.destroyed || !element.isConnected) return null;
    const { rect, fit } = viewportFit(element);
    if (fit.dw < 2 || fit.dh < 2) return null;

    const base = paramsForElement(element, this.getParams());
    const pattern = normalizeParams({ pattern: options.pattern ?? base.pattern }, base).pattern;
    if (pattern.on === 'original') return null;
    const specs = options.layers?.length ? options.layers : [{}];
    const pin = { element, entry, rect, fit, options, layers: [], top: null, tweens: [] };
    element.style.visibility = pattern.on === 'color' ? 'hidden' : '';
    element.parentElement.style.background = pattern.on === 'color'
      ? `rgb(${pattern.paper.map((v) => Math.round(v * 255)).join(' ')})`
      : '';
    this.overlay.setCanvasBlend(pattern.blend, pattern.opacity);

    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index] ?? {};
      const layerParams = normalizeParams(
        {
          ...base,
          ...(options.halftone ?? {}),
          ...(spec.halftone ?? {}),
          gradient: spec.gradient ?? options.gradient ?? base.gradient,
          pattern,
          negative: spec.negative ?? base.negative,
        },
        base,
      );
      const offset = spec.offset ?? [0, 0];
      const blend = spec.blend ?? (index > 0 ? 'multiply' : 'normal');
      const alpha = spec.alpha ?? 1;
      const designWidth = Math.max(1, layerParams.designWidth);
      const designHeight = Math.max(1, layerParams.designHeight ?? (designWidth * fit.dh) / fit.dw);
      const patternParams = { ...layerParams, designWidth, designHeight };
      const blurEntry = this.overlay.acquireBlur(
        entry.texture,
        designWidth,
        designHeight,
        layerParams.dotSize,
        layerParams.renderScale,
      );
      const surface = new Surface({
        width: fit.dw,
        height: fit.dh,
        x: rect.left + fit.dx + offset[0],
        y: rect.top + fit.dy + offset[1],
        resolution: this.overlay.hoverResolution,
        blurEntry,
        inputTexture: entry.texture,
        clip: spec.clip ?? options.clip ?? [0, 0, 1, 1],
        params: patternParams,
      });
      surface.setReveal(alpha);
      surface.setDotScale(layerParams.dotScale);
      if (blend !== 'normal') surface.sprite.blendMode = blend;
      this.overlay.patternLayer.addChild(surface.sprite);
      const record = this.overlay.trackSurface(surface, blurEntry);
      const layer = { surface, record, offset: [...offset], params: layerParams, alpha };
      pin.layers.push(layer);
      pin.top = layer;
      if (index === specs.length - 1) surface.setClip(this.clipForOffset(offset, fit.dw, fit.dh));
    }

    if (!pin.layers.length) return null;
    this._pins.push(pin);
    this._observer?.observe(element);
    this.overlay.requestRender();
    return pin;
  }

/** Clip a shifted top layer to the original image frame. */
clipForOffset(offset, width, height) {
  const ox = offset[0] || 0;
  const oy = offset[1] || 0;
  const x = Math.max(0, -ox / width);
  const y = Math.max(0, -oy / height);
  const right = Math.max(0, 1 - x - Math.max(0, ox / width));
  const bottom = Math.max(0, 1 - y - Math.max(0, oy / height));
  return [x, y, right, bottom];
}

/** Rebuild every live pattern after setParams. */
  async refreshAll() {
    const pins = [...this._pins];
    for (const pin of pins) {
      const index = this._pins.indexOf(pin);
      if (index !== -1) this._pins.splice(index, 1);
      for (const layer of pin.layers) this.overlay.destroyRecord(layer.record);
      pin.element.style.visibility = '';
    }
    for (const pin of pins) await this._pin(pin.element, pin.options);
  }

/** Set the overall reveal for one pinned image (0 = original, 1 = full pattern). */
  setReveal(element, value) {
    const pin = this.get(element);
    if (!pin) return false;
    const reveal = Math.max(0, Math.min(1, Number(value) || 0));
    for (const layer of pin.layers) {
      layer.surface.setReveal(reveal * (layer.alpha ?? 1));
    }
    this.overlay.requestRender();
    return true;
  }

/** Animate the top pattern layer offset. */
  shiftPin(element, offset, duration = 240) {
    const pin = this._pins.find((item) => item.element === element);
    if (!pin || !pin.top || !offset) return;
    const layer = pin.top;
    const start = [...layer.offset];
    for (const tween of pin.tweens) this.overlay.cancelTween(tween);
    pin.tweens.length = 0;
    if (duration <= 0) {
      layer.offset = [...offset];
      this.sync();
      return;
    }
    pin.tweens.push(
      this.overlay.tween({
        from: 0,
        to: 1,
        duration,
        ease: (t) => t * t * (3 - 2 * t),
        onUpdate: (value) => {
          layer.offset = [
            start[0] + (offset[0] - start[0]) * value,
            start[1] + (offset[1] - start[1]) * value,
          ];
          this.sync();
        },
      }),
    );
  }

/** Reposition live patterns after scroll, resize or reflow. */
  sync() {
    for (const pin of this._pins) {
      if (!pin.element.isConnected) continue;
      if (pin.layers.some((layer) => layer.record.destroyed)) {
        void this._refresh(pin);
        continue;
      }
      const { rect, fit } = viewportFit(pin.element);
      pin.rect = rect;
      pin.fit = fit;
      for (const layer of pin.layers) {
        if (layer.record.destroyed) continue;
        const [ox, oy] = layer.offset;
        layer.surface.setPosition(rect.left + fit.dx + ox, rect.top + fit.dy + oy);
        layer.surface.setSize(fit.dw, fit.dh);
        if (layer === pin.top) layer.surface.setClip(this.clipForOffset(layer.offset, fit.dw, fit.dh));
      }
    }
    this.overlay.requestRender();
  }

  /** Return the live pin for an element. */
  get(element) {
    return this._pins.find((pin) => pin.element === element) ?? null;
  }

  /** Replace a pin's config and rebuild its surfaces. */
  async update(element, options) {
    const pin = this.get(element);
    if (!pin) return this._pin(element, options);
    const index = this._pins.indexOf(pin);
    if (index !== -1) this._pins.splice(index, 1);
    for (const tween of pin.tweens) this.overlay.cancelTween(tween);
    for (const layer of pin.layers) this.overlay.destroyRecord(layer.record);
    pin.element.style.visibility = '';
    if (pin.element.parentElement) pin.element.parentElement.style.background = '';
    return this._pin(element, options);
  }

  /** Rebuild a pin after a resize invalidated its surfaces. */
  async _refresh(pin) {
    if (this._refreshing.has(pin.element)) return;
    this._refreshing.add(pin.element);
    const index = this._pins.indexOf(pin);
    if (index !== -1) this._pins.splice(index, 1);
    for (const layer of pin.layers) this.overlay.destroyRecord(layer.record);
    try {
      await this._pin(pin.element, pin.options);
    } finally {
      this._refreshing.delete(pin.element);
    }
  }

  /** Remove all live patterns without tearing down observers. */
  unpinAll() {
    for (const pin of this._pins) {
      for (const tween of pin.tweens) this.overlay.cancelTween(tween);
      pin.element.style.visibility = '';
      if (pin.element.parentElement) pin.element.parentElement.style.background = '';
      for (const layer of pin.layers) this.overlay.destroyRecord(layer.record);
    }
    this._pins = [];
    this.overlay.patternLayer?.removeChildren();
    this.overlay.setCanvasBlend('normal');
  }

/** Remove all live patterns. */
  destroy() {
    this._observer?.disconnect();
    this._observer = null;
    this.unpinAll();
  }
}
