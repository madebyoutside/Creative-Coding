import { RenderTexture } from 'pixi.js';
import { normalizeParams, paramsForElement } from './params.js';
import { Surface } from './surface.js';

/** Bakes halftone layers into PNG overlays pinned over an image. */
export class PinController {
  constructor({ overlay, getParams }) {
    this.overlay = overlay;
    this.getParams = getParams;
    this._pins = [];
  }

/** Whether an image already has a baked pin. */
  has(element) {
    return this._pins.some((pin) => pin.element === element);
  }

/** Bake the requested layers and insert their overlay images. */
  async pin(element, options = {}) {
    if (!this.overlay.supported || this.overlay.destroyed || !element) return null;
    if (this.has(element)) return null;
    const entry = await this.overlay.prepare(element);
    if (!entry || this.overlay.destroyed || !element.isConnected) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return null;
    const width = entry.fit.dw;
    const height = entry.fit.dh;
    if (width < 2 || height < 2) return null;

    const parent = element.parentElement;
    if (!parent) return null;
    const base = paramsForElement(element, this.getParams());
    const specs = options.layers?.length ? options.layers : [{}];
    const pin = { element, entry, layers: [], top: null };

    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index] ?? {};
      const layerParams = normalizeParams(
        {
          ...base,
          gradient: spec.gradient ?? base.gradient,
          multiplyColor: spec.multiplyColor !== undefined ? spec.multiplyColor : base.multiplyColor,
          negative: spec.negative ?? base.negative,
        },
        base,
      );
      const offset = spec.offset ?? [0, 0];
      const blend = spec.blend ?? (index > 0 ? 'multiply' : 'normal');
      const alpha = spec.alpha ?? 1;
      const blurEntry = this.overlay.acquireBlur(entry.texture, width, height, layerParams.dotSize);
      const surface = new Surface({
        width,
        height,
        resolution: this.overlay.hoverResolution,
        blurEntry,
        params: layerParams,
      });
      const record = this.overlay.trackSurface(surface, blurEntry);
      let url = null;
      let renderTexture = null;
      try {
        surface.setReveal(1);
        surface.setDotScale(layerParams.dotScale);
        renderTexture = RenderTexture.create({
          width: Math.max(1, Math.round(width * this.overlay.hoverResolution)),
          height: Math.max(1, Math.round(height * this.overlay.hoverResolution)),
          resolution: 1,
        });
        this.overlay.renderer.render({ container: surface.sprite, target: renderTexture, clear: true });
        url = await this.overlay.renderer.extract.base64({ target: renderTexture, resolution: 1 });
      } catch (error) {
        this.overlay.warn('pin extract', error);
      } finally {
        this.overlay.destroyRecord(record);
        renderTexture?.destroy(true);
      }
      if (!url) continue;

      const overlay = document.createElement('img');
      overlay.src = url;
      overlay.alt = '';
      overlay.className = 'halftone-pin';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.left = `${element.offsetLeft + entry.fit.dx}px`;
      overlay.style.top = `${element.offsetTop + entry.fit.dy}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      overlay.style.opacity = String(alpha);
      if (blend !== 'normal') overlay.style.mixBlendMode = blend;
      overlay.style.transform = `translate(${offset[0]}px, ${offset[1]}px)`;
      overlay.style.transition = 'transform 240ms cubic-bezier(0.2, 0.7, 0.2, 1)';
      parent.appendChild(overlay);
      const layer = { overlay, offset: [...offset] };
      pin.layers.push(layer);
      pin.top = layer;
    }

    if (!pin.layers.length) return null;
    this._pins.push(pin);
    return pin;
  }

/** Animate the top pinned overlay's offset. */
  shiftPin(element, offset, duration = 240) {
    const pin = this._pins.find((item) => item.element === element);
    if (!pin || !pin.top || !pin.top.overlay.isConnected || !offset) return;
    const layer = pin.top;
    layer.overlay.style.transition = `transform ${duration}ms cubic-bezier(0.2, 0.7, 0.2, 1)`;
    layer.overlay.style.transform = `translate(${offset[0]}px, ${offset[1]}px)`;
    layer.offset = [offset[0], offset[1]];
  }

/** Reposition baked overlays after a layout or resize. */
  sync() {
    for (const pin of this._pins) {
      if (!pin.element.isConnected) continue;
      const left = pin.element.offsetLeft + pin.entry.fit.dx;
      const top = pin.element.offsetTop + pin.entry.fit.dy;
      const width = pin.entry.fit.dw;
      const height = pin.entry.fit.dh;
      for (const layer of pin.layers) {
        if (!layer.overlay.isConnected) continue;
        layer.overlay.style.left = `${left}px`;
        layer.overlay.style.top = `${top}px`;
        layer.overlay.style.width = `${width}px`;
        layer.overlay.style.height = `${height}px`;
      }
    }
  }

/** Remove all baked overlays. */
  destroy() {
    for (const pin of this._pins) {
      for (const layer of pin.layers) layer.overlay.remove();
    }
    this._pins = [];
  }
}
