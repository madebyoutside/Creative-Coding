import { Container, RenderTexture, Sprite, Texture } from 'pixi.js';
import { createBlurFilter, createHalftoneFilter, createUniformGroup } from './shaders.js';
import { disposeTexture } from './utils.js';

const MAX_BAKE_SIZE = 4096;
const MIN_BAKE_SIZE = 32;
const MAX_CACHED_BAKES = 8;

/** Downscale and blur the source once, then share it across ink samples. */
export function bakeBlur(renderer, sourceTexture, designWidth, designHeight, dotSize, renderScale = 2) {
  const designW = Math.max(1, designWidth);
  const designH = Math.max(1, designHeight);
  const scale = Math.min(Math.max(renderScale, 0.5), MAX_BAKE_SIZE / Math.max(designW, designH));
  let bakeWidth = Math.max(MIN_BAKE_SIZE, Math.round(designW * scale));
  let bakeHeight = Math.max(MIN_BAKE_SIZE, Math.round(designH * scale));

  // Commit parity: radius in texture pixels = dotSize * texW / designW.
  const radius = Math.max(0.35, (dotSize * bakeWidth) / designW);
  const sigma = Math.max(radius / 2, 0.5);
  const weights = new Float32Array(65);
  let norm = 0;
  for (let i = 0; i < 65; i += 1) {
    const t = i - 32;
    const w = Math.exp(-(t * t) / (2 * sigma * sigma));
    weights[i] = w;
    norm += w;
  }

  const rtA = RenderTexture.create({ width: bakeWidth, height: bakeHeight, resolution: 1 });
  const rtB = RenderTexture.create({ width: bakeWidth, height: bakeHeight, resolution: 1 });

  const filterH = createBlurFilter({ resolution: 1, direction: [1, 0], radius, weights, norm });
  const filterV = createBlurFilter({ resolution: 1, direction: [0, 1], radius, weights, norm });

  const source = new Sprite(sourceTexture);
  source.width = bakeWidth;
  source.height = bakeHeight;
  source.filters = [filterH];
  const holderA = new Container();
  holderA.addChild(source);
  renderer.render({ container: holderA, target: rtA, clear: true });

  const middle = new Sprite(rtA);
  middle.width = bakeWidth;
  middle.height = bakeHeight;
  middle.filters = [filterV];
  const holderB = new Container();
  holderB.addChild(middle);
  renderer.render({ container: holderB, target: rtB, clear: true });

  source.filters = null;
  middle.filters = null;
  filterH.destroy();
  filterV.destroy();
  holderA.destroy({ children: true });
  holderB.destroy({ children: true });
  rtA.destroy(false);
  return rtB;
}

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
  constructor({ width, height, x = 0, y = 0, resolution, blurEntry, inputTexture, clip = [0, 0, 1, 1], params }) {
    this.blurEntry = blurEntry;
    this.clip = clip;
    this.uniforms = createUniformGroup();
    this.filter = createHalftoneFilter({
      resolution,
      blurTexture: blurEntry.rt,
      inputTexture: inputTexture ?? blurEntry.rt,
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
    p0[3] = (params.rotation * Math.PI) / 180;
    p1[0] = params.center[0];
    p1[1] = params.center[1];
    p1[2] = params.colorMode;

    this.params = params;
    const designWidth = Math.max(1, params.designWidth || 399);
    const designHeight = Math.max(1, params.designHeight || (designWidth * this.height) / Math.max(this.width, 1));
    const p3 = this.uniforms.uniforms.p3;
    p3[0] = designWidth;
    p3[1] = designHeight;

    const p2 = this.uniforms.uniforms.p2;
    p2[0] = params.halftoneType;
    p2[1] = params.clipToAlpha ? 1 : 0;
    p2[2] = params.negative ? 1 : 0;
    p2[3] = 0;
    const p4 = this.uniforms.uniforms.p4;
    p4[0] = this.clip[0];
    p4[1] = this.clip[1];
    p4[2] = this.clip[2];
    p4[3] = this.clip[3];

    const gradient = params.gradient;
    const colors = this.uniforms.uniforms.colors;
    const positions = this.uniforms.uniforms.positions;
    const meta = this.uniforms.uniforms.gmeta;
    const meta2 = this.uniforms.uniforms.gmeta2;
    colors.fill(0);
    positions.fill(0);
    if (gradient?.enabled && gradient.stops.length) {
      const count = Math.min(8, gradient.stops.length);
      for (let i = 0; i < count; i += 1) {
        const stop = gradient.stops[i];
        colors[i * 4] = stop.color[0];
        colors[i * 4 + 1] = stop.color[1];
        colors[i * 4 + 2] = stop.color[2];
        colors[i * 4 + 3] = stop.color[3] ?? 1;
        positions[i] = stop.position;
      }
      meta[0] = count;
      meta[1] = gradient.mixSpace;
      meta[2] = gradient.repeat;
      meta[3] = gradient.scatter;
      meta2[0] = gradient.frequency;
      meta2[1] = gradient.offset;
      meta2[3] = 1;
    } else {
      meta[0] = 0;
      meta2[3] = 0;
    }
  }

  /** Clip the surface to a normalized screen-space rectangle. */
  setClip(clip) {
    this.clip = clip;
    const p4 = this.uniforms.uniforms.p4;
    p4[0] = clip[0];
    p4[1] = clip[1];
    p4[2] = clip[2];
    p4[3] = clip[3];
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
    const params = this.params;
    if (!params) return;
    const designWidth = Math.max(1, params.designWidth || 399);
    const designHeight = Math.max(1, params.designHeight || (designWidth * height) / Math.max(width, 1));
    this.uniforms.uniforms.p3[0] = designWidth;
    this.uniforms.uniforms.p3[1] = designHeight;
  }

/** Destroy the sprite and its shader filter. */
  destroy() {
    this.sprite.filters = null;
    this.sprite.destroy();
    this.filter.destroy();
  }
}

