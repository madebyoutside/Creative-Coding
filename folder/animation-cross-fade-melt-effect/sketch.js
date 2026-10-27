import p5 from 'p5';
import { loadSettings, EASES, MELT_DIRECTIONS } from './settings.js';
import { createLibrary } from './photos.js';
import { createControls } from './controls.js';
import photo1 from '/src/assets/animation-cross-fade-melt-effect/photo-1.webp';
import photo2 from '/src/assets/animation-cross-fade-melt-effect/photo-2.webp';
import photo3 from '/src/assets/animation-cross-fade-melt-effect/photo-3.webp';
import photo4 from '/src/assets/animation-cross-fade-melt-effect/photo-4.webp';

// The default photos. Photos added in the panel join these, or replace them.
const FILES = [photo1, photo2, photo3, photo4];

// All the values you can change live from the panel (see settings.js)
const settings = loadSettings();

let library;
let controls;
let seconds = 0;

function setup() {
  const renderer = createCanvas(windowWidth, windowHeight, WEBGL);
  noStroke();
  textureWrap(MIRROR);
  meltShader = createShader(VERTEX, FRAGMENT);
  turn = makeTurn(0);
  upcoming = makeTurn(1);

  library = createLibrary(FILES, () => controls?.refresh());
  controls = createControls(settings, library, () => (photos().length ? turn.index % photos().length : -1));
  controls.refresh();

  // photos can also be dragged onto the page
  renderer.drop((file) => {
    if (file.type === 'image') library.add([file.file]);
  });
}

const photos = () => library.photos;

function draw() {
  background(0);   // so photos with see-through parts don't leave trails
  if (!photos().length) return;   // photos still loading
  if (!settings.paused) seconds += (deltaTime / 1000) * settings.speed;

  advanceTurns();
  const count = photos().length;
  const current = turn.index % count;
  const next = (current + 1) % count;

  const end = turnEnd(turn);
  const change = changeOf(turn);
  const t = constrain((seconds - (end - change)) / change, 0, 1);

  meltEffect(current, next, ease(settings.transitionEase, t));

  blurEffect(t);
}

//turns: each photo's time on screen, and the random choices made for it
function makeTurn(index) {
  return {
    index,
    start: 0,
    before: 0,            // how long the change into this photo took
    zoomIn: random() < 0.5,
    origin: random(ORIGINS),
    direction: random(DIRECTIONS),
  };
}

let turn;
let upcoming;

const stepOf = () => max(settings.step, 0.1);
const changeOf = () => max(min(settings.change, stepOf()), 0.01);
const turnEnd = (t) => t.start + stepOf(t);

function advanceTurns() {
  while (seconds >= turnEnd(turn)) {
    upcoming.start = turnEnd(turn);
    upcoming.before = changeOf(turn);
    upcoming.index = (turn.index % photos().length) + 1;
    turn = upcoming;
    upcoming = makeTurn(turn.index + 1);
  }
}

function photoRect (i, t, zoomStart, zoomEnd) {
  const photo = photos()[i].image;
  const view = zoomPanEffect(t, zoomStart, zoomEnd);

  const scale = max(width / photo.width, height / photo.height) * view.zoom;
  const w = photo.width * scale;
  const h = photo.height * scale;
  const x = width / 2 + view.x - w / 2;
  const y = height / 2 + view.y - h / 2;

  return [x, y, w, h];
}

function ease (name, t) {
  t = constrain(t, 0, 1);
  return (EASES[name] ?? EASES.linear)(t);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

//blurring effect
function blurEffect(t) {
  const blur = sin(t * PI);

  canvas.style.filter = `blur(${blur * settings.blur}px)`;
  canvas.style.transform = `scale(${1 + blur * settings.blurScale})`;
}

//zooming effect

// where a move can head: x is -1 left, 0 centre, 1 right; y is -1 top, 0 centre, 1 bottom
const ORIGINS = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [0, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

// a photo zooms the whole time it is visible: from the start of the change
// into it until the end of the change out of it
function zoomPanEffect (t, zoomStart, zoomEnd) {
  const progress = constrain((seconds - zoomStart) / (zoomEnd - zoomStart), 0, 1);

  const zoomIn = settings.zoomDirection === 'random' ? t.zoomIn : settings.zoomDirection === 'in';
  const amount = ease(settings.zoomEase, progress);
  const { zoomMin, zoomMax } = settings;
  const zoom = zoomIn
    ? lerp(zoomMin, zoomMax, amount)    // zoom in
    : lerp(zoomMax, zoomMin, amount);   // zoom out

  const origin = settings.pan ? t.origin : [0, 0];
  const spareX = (width * (zoom - 1)) / 2;
  const spareY = (height * (zoom - 1)) / 2;

  return {
    zoom,
    x: -origin[0] * spareX,
    y: -origin[1] * spareY
  };
}

//melt effect

// directions a random melt can drip: x is -1 left, 1 right; y is -1 up, 1 down
const DIRECTIONS = [
  [0, 1], [0, -1], [-1, 0], [1, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

let meltShader;

function meltEffect (current, next, t) {
  const [dx, dy] = MELT_DIRECTIONS[settings.meltDirection] ?? turn.direction;
  const length = sqrt(dx * dx + dy * dy);

  const end = turnEnd(turn);
  const rectA = photoRect(current, turn, turn.start - turn.before, end);
  const rectB = photoRect(next, upcoming, end - changeOf(turn), end + stepOf(upcoming));

  shader(meltShader);
  meltShader.setUniform('photoA', photos()[current].image);
  meltShader.setUniform('photoB', photos()[next].image);
  meltShader.setUniform('rectA', rectA);
  meltShader.setUniform('rectB', rectB);
  meltShader.setUniform('size', [width, height]);
  meltShader.setUniform('melt', settings.melt);
  meltShader.setUniform('wave', settings.wave);
  meltShader.setUniform('direction', [dx / length, dy / length]);
  meltShader.setUniform('progress', t);
  rect(0, 0, width, height);
}

// The shader: a small program the graphics card runs once for every pixel
// on the screen, to decide that pixel's colour.
const VERTEX = `
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 pos;             // 0..1 across the screen, from the top left

void main() {
  pos = vec2(aTexCoord.x, 1.0 - aTexCoord.y);
  gl_Position = vec4(aPosition.xy * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `
precision highp float;
varying vec2 pos;

uniform sampler2D photoA;     // the current photo
uniform sampler2D photoB;     // the next photo
uniform vec4 rectA;           // where each photo sits: left, top, width, height
uniform vec4 rectB;
uniform vec2 size;            // screen size in pixels
uniform float melt;           // how far the photos drip over a whole change
uniform vec2 direction;       // which way the drips fall
uniform float progress;       // 0 = start of the change, 1 = end
uniform float wave;           // how much the drips sway from side to side

// Drip a screen position (0..1) in the melt direction. Each column (a line
// across the direction) drips a different length, shaped by slow waves that
// drift as it melts, and the drips sway gently from side to side.
vec2 melted(vec2 uv, float amount, float time) {
  vec2 side = vec2(-direction.y, direction.x);
  float across = dot(uv, side);
  float col = sin(across * 2.5 + 0.7 + time * 1.2) * 0.5 + 0.5;
  float col2 = sin(across * 5.0 - 0.4 - time * 1.5) * 0.15;
  uv -= direction * amount * (col + col2 + 0.3);

  float along = dot(uv, direction);
  float sway = sin(along * 4.0 + time * 2.0) + 0.3 * sin(along * 7.0 - time * 2.5);
  uv += side * sway * abs(amount) * 0.06 * wave;
  return uv;
}

void main() {
  // already eased in sketch.js, with the Ease picked in the panel
  float t = progress;

  // A drips away the whole change. B fades in over most of it, pulled
  // back the other way at first and dripping into place.
  float swap = smoothstep(0.15, 0.95, t);
  vec2 a = (melted(pos, melt * t * 0.7, t) * size - rectA.xy) / rectA.zw;
  vec2 b = (melted(pos, -melt * (1.0 - swap) * 0.5, t) * size - rectB.xy) / rectB.zw;

  gl_FragColor = mix(texture2D(photoA, a), texture2D(photoB, b), swap);
}`;

// A module keeps its functions to itself, so hand them to p5 and start it in global mode
Object.assign(window, { setup, draw, windowResized });
new p5();
