import p5 from 'p5';
// the photo sits next to this file, in the same folder
import photoFile from './image-man.png';
// the real Figma effect code, used as it is
import * as halftoneEffect from '/src/assets/Halftone-source/main.ts';
import * as gradientMapEffect from '/src/assets/Gradient-map-source/main.ts';

// The Figma files are WebGPU code (not p5), so p5 draws the page and the original photo,
// and a second canvas on top runs the Figma effects with WebGPU.

const DOT_SIZE = 5;
const DARK = '#82C1C0';
const LIGHT = '#FFFFFF'; 
const BACKGROUND = '#CAD389'; 

// the same settings you'd pick in Figma's panel (names match the Figma files)
const HALFTONE_SETTINGS = {
  halftoneType: 0, // 0 = Dot, 1 = Blended
  colorMode: 0, // 0 = CMYK (Figma's default, colourful), 1 = RGB, 2 = BW light, 3 = BW dark
  dotSize: DOT_SIZE,
  dotScale: 1,
  softness: 0,
  rotation: 0,
  centerPos: { x: 50, y: 50 },
  clipToAlpha: false,
};
const GRADIENT_MAP_SETTINGS = {
  gradient: {
    stops: [
      { position: 0, color: hexToColor(DARK) },
      { position: 1, color: hexToColor(LIGHT) },
    ],
  },
  scatter: 0,
  offset: 0,
  repeatType: 'none',
  repeatFrequency: 2,
  mixSpace: 'sRGB',
};

// the effects you can pick from the dropdown
const ORIGINAL = 'Original';
const HALFTONE = 'Halftone';
const GRADIENT_MAP = 'Gradient map';
const BOTH = 'Halftone + gradient map';

let photo;
let effect = BOTH;
let backgroundColor = BACKGROUND; // changed with the colour picker
let gpu = null; // everything WebGPU needs, once it has started
let gpuError = ''; // shown on the page if WebGPU can't start

function preload() {
  photo = loadImage(photoFile);
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  noLoop();

  // dropdown to pick the effect
  const effectMenu = createSelect();
  effectMenu.option(ORIGINAL);
  effectMenu.option(HALFTONE);
  effectMenu.option(GRADIENT_MAP);
  effectMenu.option(BOTH);
  effectMenu.selected(BOTH);
  effectMenu.position(20, windowHeight - 54);
  effectMenu.changed(() => {
    effect = effectMenu.value();
    redraw();
  });

  // slider for the dot size
  const dotSlider = createSlider(4, 30, DOT_SIZE, 1);
  dotSlider.position(240, windowHeight - 54);

  // label next to the slider showing the current dot size
  const dotLabel = createSpan(`Dot size: ${DOT_SIZE}`);
  dotLabel.position(390, windowHeight - 52);

  dotSlider.input(() => {
    HALFTONE_SETTINGS.dotSize = dotSlider.value();
    dotLabel.html(`Dot size: ${dotSlider.value()}`);
    redraw();
  });

  // colour picker for the background
  const backgroundPicker = createColorPicker(BACKGROUND);
  backgroundPicker.position(480, windowHeight - 56);
  backgroundPicker.input(() => {
    backgroundColor = backgroundPicker.value();
    redraw();
  });
  createSpan('Background').position(540, windowHeight - 52);

  // button to pick your own photo
  const photoInput = createFileInput(changePhoto);
  photoInput.attribute('accept', 'image/*'); // only show image files in the file picker
  photoInput.position(640, windowHeight - 54);

  startGpu().catch((error) => {
    gpuError = `WebGPU error: ${error.message}`;
    redraw();
  });
}

// where each photo sits: two side by side, as big as fits, keeping the photo's shape
function layout() {
  const gap = 40;
  const boxW = (width - gap * 3) / 2;
  const boxH = height - 120;
  const scale = min(boxW / photo.width, boxH / photo.height);
  const w = floor(photo.width * scale);
  const h = floor(photo.height * scale);
  const y = (height - 80 - h) / 2;
  return { w, h, y, left: gap, right: gap * 2 + boxW };
}

function draw() {
  background(backgroundColor);
  const { w, h, y, left, right } = layout();

  // left: the original photo
  image(photo, left, y, w, h);

  // right: the original too when no effect is picked, otherwise the WebGPU canvas shows the effect
  if (effect === ORIGINAL || !gpu) image(photo, right, y, w, h);
  if (gpuError) {
    fill(0);
    text(gpuError, right, y + h + 20);
  }
  renderEffect();
}

// a new photo was picked: show it, and send it to the graphics card for the effects
function changePhoto(file) {
  if (file.type !== 'image') return;
  loadImage(file.data, (newPhoto) => {
    photo = newPhoto;
    if (gpu) loadPhotoTexture(file.data).then(redraw);
    else redraw();
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// ---------- WebGPU: running the Figma effects ----------

async function startGpu() {
  if (!navigator.gpu) {
    gpuError = 'This browser has no WebGPU, so the Figma effects cannot run. Try Chrome.';
    redraw();
    return;
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    gpuError = 'WebGPU is switched off or not supported here, so the Figma effects cannot run.';
    redraw();
    return;
  }
  const device = await adapter.requestDevice();

  // a second canvas on top of the p5 one, blended with multiply like in Figma
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.mixBlendMode = 'multiply';
  canvas.style.pointerEvents = 'none';
  document.body.appendChild(canvas);
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();

  // each Figma effect keeps its own things in a "frame", and sets itself up once
  const halftoneFrame = { state: {}, params: HALFTONE_SETTINGS };
  const gradientMapFrame = { state: {}, params: GRADIENT_MAP_SETTINGS };
  halftoneEffect.setup(device, halftoneFrame);
  gradientMapEffect.setup(device, gradientMapFrame);

  gpu = { device, canvas, context, format, photoTexture: null, halftoneFrame, gradientMapFrame, middle: null };
  await loadPhotoTexture(photoFile);
  redraw();
}

// put a photo on the graphics card (url can be a file path or an uploaded photo)
async function loadPhotoTexture(url) {
  const { device } = gpu;
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  gpu.photoTexture?.destroy(); // throw away the old photo
  gpu.photoTexture = device.createTexture({
    size: [bitmap.width, bitmap.height],
    format: 'rgba8unorm',
    viewFormats: ['rgba8unorm-srgb'],
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: gpu.photoTexture }, [bitmap.width, bitmap.height]);
}

function renderEffect() {
  if (!gpu || !gpu.photoTexture) return;
  const { device, canvas, context, format, photoTexture, halftoneFrame, gradientMapFrame } = gpu;
  const { w, h, y, right } = layout();

  canvas.style.display = effect === ORIGINAL ? 'none' : 'block';
  if (effect === ORIGINAL) return;

  // place the WebGPU canvas over the right photo, sharp on retina screens
  const density = window.devicePixelRatio || 1;
  canvas.style.left = `${right}px`;
  canvas.style.top = `${y}px`;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  if (canvas.width !== round(w * density) || canvas.height !== round(h * density)) {
    canvas.width = round(w * density);
    canvas.height = round(h * density);
    context.configure({ device, format, alphaMode: 'opaque' });
    // the halftone result is kept here before the gradient map reads it
    gpu.middle?.destroy();
    gpu.middle = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'rgba8unorm-srgb',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }
  const screen = context.getCurrentTexture();

  // Figma works in screen pixels; the canvas has more pixels on retina, so the dots grow with it
  halftoneFrame.params = { ...HALFTONE_SETTINGS, dotSize: HALFTONE_SETTINGS.dotSize * density };

  // the gradient map expects "linear" colours, so it reads the photo through an sRGB view
  const photoForGradientMap = { createView: () => photoTexture.createView({ format: 'rgba8unorm-srgb' }) };

  if (effect === HALFTONE) {
    run(halftoneEffect, halftoneFrame, photoTexture, screen);
  } else if (effect === GRADIENT_MAP) {
    run(gradientMapEffect, gradientMapFrame, photoForGradientMap, screen);
  } else {
    // both: photo -> halftone -> middle -> gradient map -> screen
    run(halftoneEffect, halftoneFrame, photoTexture, gpu.middle);
    run(gradientMapEffect, gradientMapFrame, gpu.middle, screen);
  }
}

// run one Figma effect: read from "input", draw into "output"
function run(figmaEffect, frame, input, output) {
  frame.input = input;
  frame.output = output;
  frame.inputPadding = 0;
  frame.outputPadding = 0;
  figmaEffect.render(gpu.device, frame);
}

// '#5a9157' -> { r: 0.35, g: 0.57, b: 0.34, a: 1 }, the way Figma stores colours
function hexToColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
}

Object.assign(window, { preload, setup, draw, windowResized });
new p5();
