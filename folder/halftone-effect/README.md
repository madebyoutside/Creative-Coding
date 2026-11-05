# Halftone

A GPU halftone system for photographs and page transitions. A single fixed PixiJS canvas owns the renderer; the shaders are written in **WGSL** for WebGPU and **GLSL** for the WebGL2 fallback.

Open the demo at `/Creative-Coding/folder/halftone-effect/`.

## Features

1. **Static / multi-layer halftone** — pin one or more live halftone surfaces over a photo. No baked PNGs. The surfaces sit on the one canvas and track the image through scroll and reflow.
2. **Single-image hover** — stack layers with independent gradients, alpha, offset, blend and negative; the top layer can shift on hover.
3. **Full gradient map** — 8 stops with positions, sRGB/Linear/OKLab mixing, scatter, repeat/mirror, frequency and offset. The gradient is applied to the halftone output.
4. **Real page transition** — outgoing page snapshot → IndexedDB/sessionStorage boot marker → actual navigation → incoming page boot overlay → teal-out/olive-in halftone crossfade → real page.

## Run

```bash
npm install
npm run dev
```

Then open `/Creative-Coding/folder/halftone-effect/`.

- **Index** — two effect images side by side: left single layer, right double-layer hover.
- **Coalition** — full-bleed coalition page. The logo navigates back to Index.
- Both links under `[data-page-transition]` use the cross-document transition.

The demo uses `src/assets/halftone-effect/photo-5.png` for the effect rows and `photo-2.jpg` for the Coalition background.

## Quick start

```js
const { createHalftone } = await import('./halftone/index.js');

const halftone = await createHalftone({
  params: {
    dotSize: 4,
    dotScale: 1.05,
    softness: 0,
    rotation: -180,
    center: [0.1, 0.1],
    halftoneType: 0,
    colorMode: 0,
    designWidth: 399,
    pattern: { on: 'image', paper: '#ccd391', blend: 'multiply', opacity: 1 },
  },
  zIndex: 40,
});
```

`rotation` is in **degrees**. `dotSize` is in **design pixels**, scaled to the rendered image width by `designWidth`.

## Control API

Everything is driven from the console through `window.__demo` — no visual controls.

```js
__demo.set('first', { pattern: { on: 'color', paper: '#ffffff' }, layers: [...] })
__demo.setLayer('second', 1, { alpha: 0.5, blend: 'multiply' })
__demo.setGradient('second', 0, { dark: '#1d2a8a', light: '#ffffff' })
__demo.setPattern('first', { on: 'image', blend: 'multiply', opacity: 1 })
__demo.setGlobal({ dotSize: 8, colorMode: 2 })
__demo.hover('second', [24, 24])
__demo.image('first', 'https://example.com/photo.jpg')
```

The two row names are `'first'` and `'second'`.

### Row config

```js
{
  // Image layer compositing.
  pattern: {
    on: 'color',          // color | image | original
    paper: '#ccd391',     // paper colour when on: 'color'
    blend: 'multiply',    // multiply | darken | overlay | screen | normal
    opacity: 1,
  },

  // One or more stacked halftone layers.
  layers: [
    {
      halftone: {
        dotSize: 4,
        dotScale: 1.05,
        softness: 0,
        rotation: -180,       // degrees
        center: [0.1, 0.1],
        halftoneType: 0,      // 0 dot, 1 blended
        colorMode: 0,         // 0 CMYK, 1 RGB, 2 BW light, 3 BW dark
        clipToAlpha: false,
        designWidth: 399,
        designHeight: 532,
        renderScale: 2,
        negative: false,
      },

      gradient: {
        enabled: true,
        stops: [
          { position: 0, color: '#8ebfbf' },
          { position: 1, color: '#ffffff' },
        ],
        mixSpace: 'sRGB',     // sRGB | Linear | OKLab
        scatter: 0,           // 0–100
        offset: 0,            // -100–100
        repeat: 'none',      // none | repeat | mirror
        frequency: 2,
      },

      alpha: 0.95,
      offset: [0, 0],
      blend: 'multiply',
      negative: true,
    },
  ],

  hoverOffset: [18, 18],      // top layer shift; remove to disable
}
```

`gradient` can also be `{ dark, light }` for two stops; `halftone` can be omitted to use the global defaults.

### Methods

| method | effect |
|---|---|
| `__demo.get('first')` / `__demo.first` | read a row config |
| `__demo.set('first', config)` | replace a whole row config |
| `__demo.setLayer(name, i, patch)` | patch `layers[i]` |
| `__demo.setGradient(name, i, gradient)` | replace `layers[i].gradient` |
| `__demo.setPattern(name, patch)` | merge into `pattern` |
| `__demo.addLayer(name, layer)` | push a layer |
| `__demo.removeLayer(name, i)` | remove a layer |
| `__demo.hover(name, offset)` | set/clear the top-layer hover offset |
| `__demo.setGlobal(params)` | change `dotSize`, `dotScale`, `softness`, `rotation`, `center`, `halftoneType`, `colorMode`, `clipToAlpha`, `designWidth`, `renderScale`, `negative` |
| `__demo.image(name, src)` | change the source image and rebuild |
| `__demo.apply(name)` | re-render a row after editing `__demo.first` / `__demo.second` directly |

Examples:

```js
// white paper on the left image
__demo.setPattern('first', { paper: '#ffffff' });

// bigger dots everywhere
__demo.setGlobal({ dotSize: 8 });

// shift the top layer 30px on hover
__demo.hover('second', [30, 30]);

// delete the hover shift
__demo.hover('second', null);

// add a third layer
__demo.addLayer('second', {
  gradient: { dark: '#0033aa', light: '#ffffff' },
  blend: 'multiply',
  alpha: 0.5,
});
```

The source objects are also plain JS at [demo.js:125](<demo.js#L125>) (`FIRST`) and [demo.js:155](<demo.js#L155>) (`SECOND`), and global params are at [demo.js:66](<demo.js#L66>). Changing them in code and saving triggers Vite reload.

### Low-level API

`window.__halftone` also exposes `setParams(partial)`, `pin(element, config)`, `updatePin(element, config)`, `getPinConfig(element)`, `shiftPin(element, offset, ms)`, `sync()`, `transition()`, and `destroy()`.

## Static and multi-layer pins
## Static and multi-layer pins

`pin()` creates live surfaces on the shared canvas. It never extracts a PNG.

```js
await halftone.pin(img, {
  layers: [
    {
      gradient: { stops: [{ position: 0, color: '#5E8C4A' }, { position: 1, color: '#FFFFFF' }] },
    },
  ],
});
```

- The image must be loaded before `pin()`.
- `shiftPin(element, offset, ms)` animates the top surface.
- `sync()` repositions all surfaces after layout changes.
- The pattern layer composites with the page through CSS `mix-blend-mode`; the default is `multiply`.

The two images sit side by side in one row: the left is the commit’s green/olive single layer; the right is two multiplied layers with a hover shift on the top layer.

```js
await halftone.pin(img, {
  layers: [
    {
      gradient: { stops: [{ position: 0, color: '#FFFFFF' }, { position: 1, color: '#FF512F' }] },
      negative: true,
      alpha: 0.95,
    },
    {
      gradient: { stops: [{ position: 0, color: '#5E8C4A' }, { position: 1, color: '#FFFFFF' }] },
      alpha: 0.55,
      blend: 'multiply',
      offset: [4, 4],
    },
  ],
});
```

### Layer options

| property | meaning |
|---|---|
| `gradient` | full gradient object (`stops`, mix/scatter/repeat/offset/frequency) |
| `halftone` | partial halftone params for this layer |
| `pattern` | partial pattern object for this pin |
| `alpha` | surface opacity, 0–1 |
| `offset` | `[x, y]` in CSS px |
| `blend` | `normal` or `multiply` |
| `negative` | invert the source before the dots |

## Params

| param | default | meaning |
|---|---|---|
| `dotSize` | 4 | dot pitch in design px |
| `dotScale` | 1.05 | dot radius multiplier |
| `softness` | 0 | dot edge softness, 0–1 |
| `rotation` | -180 | screen rotation, degrees |
| `center` | `[0.1, 0.1]` | dot-grid origin, normalised |
| `halftoneType` | `0` | `0` dot, `1` blended (Euclidean) |
| `colorMode` | `0` | `0` CMYK, `1` RGB, `2` BW light, `3` BW dark |
| `clipToAlpha` | `false` | retain source alpha |
| `designWidth` | `399` | reference width for dot sizing |
| `renderScale` | `2` | blur/pattern bake scale, capped at 4096 |
| `negative` | `false` | invert the source before the halftone |
| `pattern` | image / `#ccd391` / multiply / 1 | pattern compositing |
| `gradient` | `null` | full gradient map |

### Gradient

```js
gradient: {
  stops: [
    { position: 0, color: '#82C1C0' },
    { position: 0.55, color: '#F4F0DF' },
    { position: 1, color: '#FFFFFF' },
  ],
  mixSpace: 'sRGB',       // sRGB | Linear | OKLab
  scatter: 18,            // 0–100
  repeat: 'none',         // none | repeat | mirror
  frequency: 2,           // 1–10
  offset: 0,              // -100–100
}
```

The gradient is applied after the halftone dots. There is no before-halftone mode; this follows the requested after-only behavior. For backwards compatibility `{ dark, light }` still works and becomes two stops.

### Pattern

```js
pattern: {
  on: 'image',            // image | color | original
  paper: '#ccd391',
  blend: 'multiply',      // multiply | darken | overlay | screen | normal
  opacity: 1,
}
```

`blend: 'multiply'` is the commit’s `.art canvas { mix-blend-mode: multiply }` composite. The old branch-only `multiplyColor` page tint is not part of the commit and is not part of this API. The demo rows use `on: 'color'` with per-tile paper colours, so the pattern multiplies onto the paper rather than the original photo.

## Page transition

`[data-page-transition]` links are intercepted by **Swup** with the custom halftone effect:

1. Swup intercepts the navigation and loads the incoming page in the background (`visit:start`).
2. Halftone snapshots the outgoing page, displays the outgoing teal treatment (1400 ms), and holds.
3. Swup swaps the `#app` container, updates the URL/history, and initializes the incoming DOM and images.
4. Halftone snapshots the incoming page and crossfades to the incoming olive treatment (1400 ms).
5. Halftone resolves (700 ms) and reveals the live interactive page.
6. The PixiJS/WebGPU context remains persistent across transitions without full page reloads.

Browser back/forward history navigation is also animated seamlessly via `animateHistoryBrowsing: true`.

## API

### `createHalftone(options)`

| option | default | meaning |
|---|---|---|
| `params` | defaults | base halftone params |
| `zIndex` | 40 | overlay canvas z-index |
| `hoverResolution` | min(dpr, 2) | hover surface resolution |
| `transitionResolution` | min(dpr, 1.5) | transition surface resolution |
| `capture` | `{ pixelRatio: 0.75, maxDimension: 1600 }` | snapshot options |
| `transitionParams` | `params` | transition fallback |
| `backingColor` | auto | transition paper colour |

### Methods

`attachHover(elements)`, `detachHover()`, `hover(element)`, `unhover()`, `prepare(element)`, `prewarm()`, `setParams(partial)`, `pin(element, options)`, `shiftPin(element, offset, ms)`, `sync()`, `transition(update, options)`, `captureSnapshot()`, `invalidateSnapshot()`, `destroy()`.

- `setParams(partial)` updates hover params and rebuilds every live pin.
- `pin()` accepts per-layer `halftone` / `gradient` / `pattern` overrides.
- `sync()` repositions live surfaces after resize/layout changes.

Getters: `supported`, `backend`, `params`, `active`, `busy`, `renderCount`, `snapshotCached`, `lastTransition`.

### Per-element overrides

```html
<img data-halftone
     data-halftone-type="blended"
     data-halftone-color-mode="bw-dark"
     data-halftone-clip="true"
     data-halftone-dot-size="4"
     data-halftone-dot-scale="0.9"
     data-halftone-softness="0.1"
     data-halftone-rotation="-180"
     data-halftone-center="0.5,0.5"
     data-halftone-gradient="#82C1C0,#FFFFFF"
     data-halftone-negative="true">
```

## How it works

**Blur.** The source is baked at `renderScale` × the design size (2× by default, capped at 4096) and blurred with a separable **65-tap** Gaussian (two custom filter passes). The radius is `dotSize × bakeWidth / designWidth`, matching the commit.

**Halftone.** The dot screen samples the ink at **all nine neighbouring cell centres**, so large dots use their own tone rather than a shared centre sample. CMYK angles are 15°, 75°, 0° and 45°. `halftoneType: 'blended'` switches to the smooth Euclidean screen. BW light/dark and clip-to-alpha (using the original source alpha) are supported. The negative inverts the source before the dots.

**Gradient.** After the halftone colour is built, it is converted from linear to sRGB for its Rec.709 luma, mapped through up to eight stops (with stop alpha, scatter, repeat and offset), and the result is premultiplied back onto the halftone alpha. Scatter coordinates are in design units.

**Pins.** Each layer is a `Surface` on the pattern layer of the shared canvas. The canvas itself uses CSS multiply, so the page shows through. There is no PNG extraction and no `.halftone-pin` image.

**Page transition.** The outgoing page is captured with html-to-image and stored. The incoming page captures itself while the stored outgoing image covers it, renders both through the halftone surfaces, crossfades and resolves. During the transition the canvas blend is `normal` and the pattern layer is hidden.

## Performance

- Live surfaces render only when dirty; scrolling repositions without re-baking.
- Nine patterns share one canvas and one ticker.
- Pins share a blur cache keyed by texture and size.
- The transition reuses the outgoing snapshot for the duration of the run.

## Limitations

- Cross-origin images need CORS for texture upload and html-to-image snapshots.
- CSS transforms are not tracked; positions come from `getBoundingClientRect()`.
- `border-radius` is not clipped; `clip-path`/masks are ignored.
- The cross-document transition needs IndexedDB and sessionStorage.
- Very large pages are downscaled by the capture options.
- `dotSize` is in design px; use `designWidth` to match a Figma frame.

## Debug hook

`window.__halftoneDebug` exposes `ready`, `supported`, `backend`, `active`, `busy`, `renderCount`, `snapshotCached`, `lastTransition` and `navigate(url)`.

## Files

```
halftone-effect/
├── index.html          effect rows
├── coalition.html      coalition page
├── demo.js             image loading, pins, cross-document links
├── demo.css            page layout
└── halftone/
    ├── index.js        createHalftone()
    ├── Halftone.js     facade / public API
    ├── overlay.js      renderer, canvas, layers, ticker, lifecycle
    ├── hover.js        single-image pointer hover
    ├── pins.js         live multi-layer surfaces
    ├── transition.js   same-page snapshot transition
    ├── page-transition.js  IndexedDB/sessionStorage boot + decode
    ├── surface.js      halftone surface + 65-tap blur bake
    ├── shaders.js      WGSL/GLSL halftone, gradient and blur shaders
    ├── capture.js      html-to-image snapshot
    ├── texture.js      <img> crop / downscale
    ├── params.js       defaults, gradient/pattern parsing, data overrides
    └── utils.js        tweens, easing, texture disposal
```
