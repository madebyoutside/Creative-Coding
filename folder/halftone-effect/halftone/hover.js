import { Surface } from './surface.js';
import { paramsForElement } from './params.js';
import { easeOutCubic } from './utils.js';

const IN_MS = 300;
const OUT_MS = 220;

/** Single-image pointer hover: decode, filter and fade one surface. */
export class HoverController {
  constructor({ overlay, getParams, isPinned, isBusy, reducedMotion }) {
    this.overlay = overlay;
    this.getParams = getParams;
    this.isPinned = isPinned;
    this.isBusy = isBusy;
    this.reducedMotion = reducedMotion;

    this._targets = [];
    this._listeners = [];
    this._documentTap = null;
    this._token = 0;
    this._activeHover = null;
  }

  get active() {
    return this._activeHover != null;
  }

/** Attach pointer or tap listeners to image elements. */
  attach(targets) {
    this.detach();
    if (!this.overlay.supported) return;

    const list = targets instanceof Element ? [targets] : Array.from(targets || []);
    this._targets = list.filter((element) => element && element.tagName === 'IMG');
    const coarse = window.matchMedia?.('(hover: none), (pointer: coarse)')?.matches ?? false;

    for (const element of this._targets) {
      if (coarse) {
        const onTap = (event) => {
          event.preventDefault();
          if (this._activeHover?.img === element) this.unhover();
          else void this.hover(element);
        };
        element.addEventListener('click', onTap);
        this._listeners.push([element, 'click', onTap]);
      } else {
        const onEnter = (event) => {
          if (!event.pointerType || event.pointerType === 'mouse') void this.hover(element);
        };
        const onLeave = (event) => {
          if (!event.pointerType || event.pointerType === 'mouse') this.unhover();
        };
        element.addEventListener('pointerenter', onEnter);
        element.addEventListener('pointerleave', onLeave);
        this._listeners.push([element, 'pointerenter', onEnter], [element, 'pointerleave', onLeave]);
      }
    }

    if (coarse) {
      this._documentTap = (event) => {
        const inside = this._targets.some(
          (element) => element === event.target || element.contains?.(event.target),
        );
        if (!inside) this.unhover();
      };
      document.addEventListener('click', this._documentTap, true);
    }
  }

/** Remove listeners and release any active hover surface. */
  detach() {
    for (const [element, type, handler] of this._listeners) {
      element.removeEventListener(type, handler);
    }
    this._listeners = [];
    if (this._documentTap) {
      document.removeEventListener('click', this._documentTap, true);
      this._documentTap = null;
    }
    this._token += 1;
    this._endHover(false);
    this._targets = [];
  }

/** Run the hover effect for one image. */
  async hover(element) {
    if (!this.overlay.supported || this.overlay.destroyed || this.isBusy() || !element) return;
    if (this.isPinned(element)) return;
    if (this._activeHover?.img === element) return;

    const token = ++this._token;
    this._endHover(false);

    const entry = await this.overlay.prepare(element);
    if (!entry || this.overlay.destroyed || this.isBusy() || token !== this._token || !element.isConnected) {
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    const params = paramsForElement(element, this.getParams());
    const width = entry.fit.dw;
    const height = entry.fit.dh;
    if (width < 2 || height < 2) return;

    const blurEntry = this.overlay.acquireBlur(entry.texture, width, height, params.dotSize);
    const surface = new Surface({
      width,
      height,
      x: rect.left + entry.fit.dx,
      y: rect.top + entry.fit.dy,
      resolution: this.overlay.hoverResolution,
      blurEntry,
      params,
    });
    this.overlay.hoverLayer.addChild(surface.sprite);
    const record = this.overlay.trackSurface(surface, blurEntry);

    surface.setReveal(this.reducedMotion ? 1 : 0);
    surface.setDotScale(params.dotScale);

    this._activeHover = {
      img: element,
      entry,
      record,
      surface,
      params,
      offsetX: entry.fit.dx,
      offsetY: entry.fit.dy,
      tweens: [],
    };
    this.overlay.requestRender();

    if (!this.reducedMotion) {
      this._activeHover.tweens.push(
        this.overlay.tween({
          from: 0,
          to: 1,
          duration: IN_MS,
          ease: easeOutCubic,
          onUpdate: (value) => {
            if (!record.destroyed) surface.setReveal(value);
          },
        }),
      );
    }
  }

/** Fade out the active hover surface. */
  unhover() {
    this._token += 1;
    this._endHover(true);
  }

/** Cancel the hover immediately when a transition starts. */
  cancel() {
    this._token += 1;
    this._endHover(false);
  }

  _endHover(animate) {
    const active = this._activeHover;
    if (!active) return;
    this._activeHover = null;
    this.overlay.cancelTweens(active.tweens);

    const record = active.record;
    if (animate && !this.reducedMotion && !record.destroyed && active.surface.reveal > 0.001) {
      this.overlay.tween({
        from: active.surface.reveal,
        to: 0,
        duration: OUT_MS,
        ease: easeOutCubic,
        onUpdate: (value) => {
          if (!record.destroyed) active.surface.setReveal(value);
        },
        onComplete: () => this.overlay.destroyRecord(record),
      });
    } else {
      this.overlay.destroyRecord(record);
    }
  }

/** Realign the active hover surface after scroll or layout. */
  syncRect() {
    const active = this._activeHover;
    if (!active) return;
    const rect = active.img.getBoundingClientRect();
    active.surface.setPosition(rect.left + active.offsetX, rect.top + active.offsetY);
    this.overlay.requestRender();
  }

/** Decode the attached images ahead of first hover. */
  prewarm() {
    if (!this.overlay.supported) return Promise.resolve();
    return Promise.all(this._targets.map((element) => this.overlay.prepare(element)));
  }

/** Reapply base params to the active hover surface. */
  applyParams() {
    const active = this._activeHover;
    if (!active || active.record.destroyed) return;
    active.surface.setParams(paramsForElement(active.img, this.getParams()));
  }

/** Drop the active hover after the overlay rebuild. */
  handleResize() {
    const active = this._activeHover;
    if (!active) return;
    this._activeHover = null;
    this._token += 1;
    this.overlay.cancelTweens(active.tweens);
  }

/** Remove listeners and release the hover surface. */
  destroy() {
    this.detach();
    this._endHover(false);
  }
}
