# Halftone

A GPU halftone system for photographs and page transitions. PixiJS owns the renderer; the shaders are written in **WGSL** for WebGPU and **GLSL** for the WebGL2 fallback.

Open the demo at `/Creative-Coding/folder/halftone-effect/`.

## Features

1. **Static halftone** — bake the halftone permanently over an image. No hover required; one or more layers.
2. **Multiple layers + hover** — stack several halftone layers on one image, each with its own gradient, multiply, alpha, offset, blend and negative mode. The top layer can be shifted on hover.
3. **Page transition** — snapshot the whole page, halftone it (photos, copy and form included), crossfade with the incoming page's halftone. The outgoing page uses the teal ramp; the incoming page uses olive.

## Run

```bash
npm install
npm run dev
```

Then open `/Creative-Coding/folder/halftone-effect/`.

- **Index** — two rows of default effect studies. The page scrolls to row 2.
- **Coalition** — a full-bleed replica of the Human First page; the page's own logo links back to Index.

The demo uses `src/assets/halftone-effect/photo-5.png` for the effect rows and `photo-2.jpg` for the Coalition background.

## Quick start

```js
const { createHalftone } = await import('./halftone/index.js');

const halftone = await createHalftone({
  params: {
    dotSize: 4,
    dotScale: 1.05,
    softness: 0,
    rotation: 0,
    center: [0.1, 0.1],
    colorMode: 0,
  },
  zIndex: 40,
});
```

## 1. Static halftone

`pin()` renders the halftone for an image once and places it over the photo as a baked PNG overlay. It stays on without hover, scrolls with the page, and is included in page-transition snapshots.

```js
await halftone.pin(img, {
  layers: [
    {
      gradient: { dark: '#5E8C4A', light: '#FFFFFF' },
      multiplyColor: '#CAD48A',
    },
  ],
});
```

- The image needs to be loaded before `pin()` (the demo awaits `img.decode()`).
- Call `sync()` after a layout change/resize so the overlay follows the image.
- For a single static color treatment, one layer is enough. The first row of the demo uses this: green/olive, orange/salmon, teal/ice.
- The `multiplyColor` is the image layer's multiply with the page background; it also sets the overlay's paper colour.
- The overlay is an `<img class="halftone-pin">` in the DOM. It is not part of the WebGL/WebGPU canvas, so it scrolls natively and survives a page snapshot.

### The gradient map

The halftone output is mapped through two stops:

- `dark` colours the darkest halftone pixels.
- `light` colours the brightest.
- `blend: 'replace'` makes a duotone; `blend: 'multiply'` multiplies the ramp over the halftone.

## 2. Multiple layers + hover

`pin()` accepts any number of layers for one image. Every layer is rendered and baked to its own overlay. The layers stack in order; each can have its own:

| property | meaning |
|---|---|
| `gradient` | `{ dark, light, blend }` colour ramp |
| `multiplyColor` | page-background multiply / paper colour |
| `alpha` | overlay opacity, 0–1 |
| `offset` | `[x, y]` in CSS px |
| `blend` | `'normal'` or `'multiply'` |
| `negative` | invert the source before the halftone |

The top layer usually uses `blend: 'multiply'` and a lower alpha, so the lower layer shows through. `shiftPin()` animates the top overlay's offset:

```js
await halftone.pin(img, {
  layers: [
    {
      gradient: { dark: '#FFFFFF', light: '#FF512F' },
      negative: true,
      alpha: 0.95,
    },
    {
      gradient: { dark: '#5E8C4A', light: '#FFFFFF' },
      alpha: 0.8,
      blend: 'multiply',
      offset: [4, 4],
    },
  ],
});

img.addEventListener('pointerenter', () => halftone.shiftPin(img, [14, 14]));
img.addEventListener('pointerleave', () => halftone.shiftPin(img, [4, 4]));
```

This is the demo's second row: Layer 1 orange (negative), Layer 2 green, multiplied; the default is the small offset, hover shifts the top layer.

### Negative images

Reversing only the gradient swaps the **colours** but leaves the halftone dot pattern unchanged. A true negative also needs the source luminance inverted, which is what `negative: true` does before the CMYK/RGB dot calculation. Use both for a full negative: a reversed ramp plus `negative: true`. The demo's first layer uses `#FFFFFF → #FF512F` with `negative: true`.

The same options work as per-element data attributes for the single-image hover API: `data-halftone-gradient`, `data-halftone-multiply`, `data-halftone-negative`, etc.

## 3. Page transition

`transition()` captures the visible page, halftones the whole snapshot (photos, text, form fields, copy), swaps the view, captures the incoming page, and crossfades the two halftones before resolving to the real page.

```js
await halftone.transition(
  () => {
    showNextView();
    history.pushState({ page: 'next' }, '', '#next');
  },
  {
    outgoingParams: { gradient: { dark: '#82C1C0', light: '#FFFFFF' } },
    incomingParams: { gradient: { dark: '#B7BB92', light: '#FFFFFF' } },
  },
);
```

- **Outgoing** uses the teal ramp (`#82C1C0`); **incoming** uses olive (`#B7BB92`). The page transition does **not** inherit the image effect's `multiplyColor`; set it explicitly on `outgoingParams`/`incomingParams` if you want a page multiply.
- The form and text are part of the snapshot, so they appear as halftone dots rather than disappearing under a background-only effect.
- The outgoing snapshot is cached after the first transition; `captureSnapshot()` prewarms it and `invalidateSnapshot()` clears it.
- The outgoing treatment holds for ~2.4 s, then the incoming treatment crossfades for ~2.4 s and resolves in ~0.3 s.
- `outgoingParams` / `incomingParams` are partial params; they inherit the base `params`, except `multiplyColor`, which is skipped unless passed explicitly.
- All effects use the same base dot params (`dotSize`, `dotScale`, `softness`, `rotation`, `center`, `colorMode`); only the gradient/alpha/offset/blend/negative differ.
- `options.params` sets both sides; `transitionParams` in the constructor is the fallback.
- The captured page includes the static/multi-layer overlays (they are DOM images), so the default effect rows are part of the transition.

### Transition tuning

`capture: { pixelRatio, maxDimension }` in the constructor controls the snapshot resolution. `transitionResolution` controls the halftone surface resolution. `backingColor` overrides the paper colour; by default it is the gradient light stop multiplied by `multiplyColor`.

## API

### `createHalftone(options)`

| option | default | meaning |
|---|---|---|
| `params` | defaults | base halftone params |
| `zIndex` | 40 | overlay canvas z-index |
| `hoverResolution` | min(dpr, 2) | hover surface resolution |
| `transitionResolution` | min(dpr, 1.5) | transition surface resolution |
| `capture` | `{ pixelRatio: 0.75, maxDimension: 1600 }` | html-to-image snapshot options |
| `transitionParams` | `params` | fallback transition params |
| `backingColor` | auto | transition paper colour |

### Params

| param | default | meaning |
|---|---|---|
| `dotSize` | 4 | dot pitch in CSS px (min 4) |
| `dotScale` | 1.05 | dot radius multiplier |
| `softness` | 0 | dot edge softness (0–1) |
| `rotation` | 0 | screen rotation, radians |
| `center` | `[0.1, 0.1]` | dot-grid origin, normalised |
| `colorMode` | 0 | 0 = CMYK, 1 = RGB |
| `gradient` | `null` | `{ dark, light, blend }` |
| `multiplyColor` | `null` | page-background multiply |
| `negative` | `false` | invert the source before the halftone |

### Methods

`attachHover(elements)`, `detachHover()`, `hover(element)`, `unhover()`, `prepare(element)`, `prewarm()`, `setParams(partial)`, `pin(element, options)`, `shiftPin(element, offset, ms)`, `sync()`, `transition(update, options)`, `captureSnapshot()`, `invalidateSnapshot()`, `destroy()`.

- `attachHover` / `hover` / `unhover` are the single-image pointer API; the demo now uses pinned layers instead. They still use the `data-halftone` marker and the `data-halftone-*` overrides.
- `pin` is for static / multi-layer default effects; `shiftPin` is the hover shift for a pinned image.
- `sync()` repositions the baked overlays after a resize/layout change.
- `setParams()` updates the hover effect's base params.

Getters: `supported`, `backend`, `params`, `active`, `busy`, `renderCount`, `snapshotCached`, `lastTransition`.

### Per-element overrides

```html
<img data-halftone
     data-halftone-color-mode="rgb"
     data-halftone-dot-size="4"
     data-halftone-dot-scale="0.9"
     data-halftone-softness="0.1"
     data-halftone-rotation="0.2"
     data-halftone-center="0.5,0.5"
     data-halftone-gradient="#82C1C0,#FFFFFF"
     data-halftone-gradient-blend="replace"
     data-halftone-multiply="#CAD48A"
     data-halftone-negative="true">
```

These apply to the single-image hover API. The demo's pinned layers set the same values programmatically.

## How it works

**Halftone shader.** The image is baked into a small blurred texture (about four texels per dot). The fragment shader reads one blur sample per ink at the nearest dot centre and reuses it for the nine coverage tests; CMYK uses four reads per pixel. Screen angles are 15°, 75°, 0° and 45°. The result goes through the gradient map, the optional negative (source inverted before the dots), and the page multiply.

**Pinned effects.** `pin()` renders each layer's filtered surface into a render texture, extracts it as a PNG, and inserts an `<img class="halftone-pin">` over the photo. The top layer uses CSS `mix-blend-mode: multiply` and the layer alpha. The overlays scroll with the page and are captured by the transition snapshot.

**Page transition.** The visible page is captured with html-to-image, rendered through the halftone surface with the outgoing params, then the incoming page is captured and rendered with the incoming params. The two halftone snapshots crossfade and resolve to the real page. The outgoing snapshot is cached after the first run.

## Performance

- Pinned layers are baked once; scrolling costs nothing.
- The transition uses two snapshots (~6 s: 2.4 s outgoing hold, 2.4 s incoming crossfade, 0.3 s resolve, plus the incoming capture; the second run reuses the cached outgoing snapshot).
- The hover surface uses one small blur texture per image.

## Limitations

- **Cross-origin images** need CORS for the texture upload and the html-to-image transition.
- CSS transforms are not tracked; the overlays are positioned from `getBoundingClientRect()`.
- `border-radius` is not clipped; `clip-path`/masks are ignored.
- Output is opaque for the image effect: transparent PNGs are halftoned onto paper.
- Baked overlays are DOM images above the page; overlapping content needs its own stacking order.
- The transition converts the whole page's text and form to halftone dots; it is not a live overlay.
- The index page scrolls; the baked overlays move with the photos.
- `dotSize` is in CSS px; scale it by `displayWidth / figmaFrameWidth` to match a Figma frame.
- Fast colour sampling is intentional: neighbours share the radius sampled at the nearest dot centre.
- Only the gradient's colour stops are ported; scatter/offset/repeat/mix space are not.

## Debug hook

`window.__halftoneDebug` exposes `ready`, `supported`, `backend`, `active`, `busy`, `renderCount`, `snapshotCached`, `lastTransition` (`{ mode: 'snapshot', incoming, incomingMs, totalMs }`) and `navigate(name)`.

## Files

```
halftone-effect/
├── index.html          effect rows + Coalition replica
├── demo.js             image loading, pinned effects, nav, transition
├── demo.css            demo layout
└── halftone/
    ├── index.js        createHalftone()
    ├── Halftone.js     facade / public API
    ├── overlay.js      renderer, canvas, layers, ticker, blur, lifecycle
    ├── hover.js        single-image pointer hover
    ├── pins.js         static / multi-layer baked overlays
    ├── transition.js   snapshot page transition
    ├── surface.js      halftone surface + blur bake
    ├── shaders.js      WGSL/GLSL halftone shader
    ├── capture.js      html-to-image snapshot
    ├── texture.js      <img> crop / downscale
    ├── params.js       defaults, gradient parsing, data overrides
    └── utils.js        tweens, easing, texture disposal
```
