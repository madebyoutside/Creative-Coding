import { BlurFilter, Container, RenderTexture, Sprite, Texture } from 'pixi.js';
import { createHalftoneFilter, createUniformGroup } from './shaders.js';
import { disposeTexture } from './utils.js';

const MAX_BAKE_SIZE = 1024;
const MIN_BAKE_SIZE = 32;
const TEXELS_PER_DOT = 4;
const MAX_CACHED_BAKES = 8;

/** Downscale and blur the source once, then share it across ink samples. */
export function bakeBlur(renderer, sourceTexture, width, height, dotSize) {
  const pitch = Math.max(dotSize, 0.5);
  let bakeWidth = Math.max(MIN_BAKE_SIZE, Math.round((width / pitch) * TEXELS_PER_DOT));
  let bakeHeight = Math.max(MIN_BAKE_SIZE, Math.round((height / pitch) * TEXELS_PER_DOT));
  const cap = Math.min(1, MAX_BAKE_SIZE / Math.max(bakeWidth, bakeHeight));
  bakeWidth = Math.max(MIN_BAKE_SIZE, Math.round(bakeWidth * cap));
  bakeHeight = Math.max(MIN_BAKE_SIZE, Math.round(bakeHeight * cap));

  const renderTexture = RenderTexture.create({
    width: bakeWidth,
    height: bakeHeight,
    resolution: 1,
  });

  const sprite = new Sprite(sourceTexture);
  sprite.width = bakeWidth;
  sprite.height = bakeHeight;

  // Bake at ~4 texels/dot; Pixi strength = sigma / 2, sigma = dotSize / 2.
  const sigma = Math.max(0.35, (dotSize * 0.5 * bakeWidth) / width);
  const blur = new BlurFilter({ strength: sigma * 0.5, quality: 4, resolution: 1 });
  blur.padding = 0;
  sprite.filters = [blur];

  const holder = new Container();
  holder.addChild(sprite);

  renderer.render({ container: holder, target: renderTexture, clear: true });

  sprite.filters = null;
  blur.destroy();
  holder.destroy({ children: true });

  return renderTexture;
}

/** Share blur textures across surfaces with the same source and dot pitch. */
export class BlurCache {
  constructor(renderer, max = MAX_CACHED_BAKES) {
    this.renderer = renderer;
    this.max = max;
    this.entries = new Map();
  }

/** Get or build a blur texture and add a reference. */
  acquire(key, make) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { rt: make(), refs: 1, last: performance.now() };
      this.entries.set(key, entry);
      this._trim();
    } else {
      entry.refs += 1;
      entry.last = performance.now();
    }
    return entry;
  }

/** Drop a reference; unused entries are evicted on the next acquire. */
  release(entry) {
    if (entry) entry.refs = Math.max(0, entry.refs - 1);
  }

/** Evict the least recently used unreferenced blur textures. */
  _trim() {
    if (this.entries.size <= this.max) return;
    const free = [...this.entries.entries()]
      .filter(([, entry]) => entry.refs === 0)
      .sort((a, b) => a[1].last - b[1].last);
    for (const [key, entry] of free) {
      if (this.entries.size <= this.max) break;
      this.entries.delete(key);
      disposeTexture(entry.rt);
    }
  }

/** Release every cached blur texture. */
  destroy() {
    for (const entry of this.entries.values()) disposeTexture(entry.rt);
    this.entries.clear();
  }
}

/** One halftone sprite plus the packed uniforms that drive it. */
export class Surface {
  constructor({ width, height, x = 0, y = 0, resolution, blurEntry, params }) {
    this.blurEntry = blurEntry;
    this.uniforms = createUniformGroup();
    this.filter = createHalftoneFilter({
      resolution,
      blurTexture: blurEntry.rt,
      uniforms: this.uniforms,
    });

    this.sprite = new Sprite(Texture.WHITE);
    this.sprite.position.set(x, y);
    this.sprite.width = width;
    this.sprite.height = height;
    this.sprite.filters = [this.filter];

    this.width = width;
    this.height = height;
    this.setParams(params);
    this.setReveal(1);
  }

/** Push params into the shader's packed uniform vectors. */
  setParams(params) {
    const p0 = this.uniforms.uniforms.p0;
    const p1 = this.uniforms.uniforms.p1;
    p0[0] = params.dotSize;
    p0[1] = params.dotScale;
    p0[2] = params.softness;
    p0[3] = params.rotation;
    p1[0] = params.center[0];
    p1[1] = params.center[1];
    p1[2] = params.colorMode;

    const p2 = this.uniforms.uniforms.p2;
    const p3 = this.uniforms.uniforms.p3;
    const gradient = params.gradient;
    if (gradient) {
      p2[0] = gradient.dark[0];
      p2[1] = gradient.dark[1];
      p2[2] = gradient.dark[2];
      p2[3] = 1;
      p3[0] = gradient.light[0];
      p3[1] = gradient.light[1];
      p3[2] = gradient.light[2];
      p3[3] = gradient.blend === 'multiply' ? 1 : 0;
    } else {
      p2[3] = 0;
    }

    const p4 = this.uniforms.uniforms.p4;
    const multiply = params.multiplyColor;
    if (multiply) {
      p4[0] = multiply[0];
      p4[1] = multiply[1];
      p4[2] = multiply[2];
      p4[3] = 1;
    } else {
      p4[3] = 0;
    }

    this.uniforms.uniforms.p5[0] = params.negative ? 1 : 0;
  }

/** Set the reveal amount used by hover/transition fades. */
  setReveal(value) {
    this.reveal = value;
    this.uniforms.uniforms.p1[3] = value;
  }

/** Override the dot radius multiplier. */
  setDotScale(value) {
    this.dotScale = value;
    this.uniforms.uniforms.p0[1] = value;
  }

/** Move the surface in CSS pixels. */
  setPosition(x, y) {
    this.sprite.position.set(x, y);
  }

/** Resize the surface without rebuilding its filter. */
  setSize(width, height) {
    this.sprite.width = width;
    this.sprite.height = height;
    this.width = width;
    this.height = height;
  }

/** Destroy the sprite and its shader filter. */
  destroy() {
    this.sprite.filters = null;
    this.sprite.destroy();
    this.filter.destroy();
  }
}

