import p5 from 'p5';
import photo1 from '/src/assets/animation-hfcc/photo-1.webp';
import photo2 from '/src/assets/animation-hfcc/photo-2.webp';
import photo3 from '/src/assets/animation-hfcc/photo-3.webp';
import photo4 from '/src/assets/animation-hfcc/photo-4.webp';

const FILES = [photo1, photo2, photo3, photo4];

const STEP = 4;
// const STEP = 12;
const CHANGE = 4;

let photos = [];
let seconds = 0;

function preload() {
  photos = FILES.map((file) => loadImage(file));
}

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL); 
  noStroke();
  textureWrap(MIRROR); 
  meltShader = createShader(VERTEX, FRAGMENT);
  photos.forEach((photo) => photo.resize(2560, 0));
}

function draw() {
  seconds = millis() / 1000;
  const current = floor(seconds / STEP) % photos.length;
  const next = (current + 1) % photos.length;

  const t = constrain(((seconds % STEP) - (STEP - CHANGE)) / CHANGE, 0, 1);

  meltEffect(current, next, t);

  blurEffect(t);
}

function photoRect (i) {
  const photo = photos[i];
  const view = zoomPanEffect(i);

  const scale = max(width / photo.width, height / photo.height) * view.zoom;
  const w = photo.width * scale;
  const h = photo.height * scale;
  const x = width / 2 + view.x - w / 2;
  const y = height / 2 + view.y - h / 2;

  return [x, y, w, h];
}

function ease (t) {
  t = constrain(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

//blurring effect
const BLUR = 1.5;

function blurEffect(t) {
  const blur = sin(t * PI);

  canvas.style.filter = `blur(${blur * BLUR}px)`;
  canvas.style.transform = `scale(${1 + blur * 0.05})`;
}

//zooming effect
const ZOOM_MIN = 1.05;
const ZOOM_MAX = 1.4;

// where a move can head: x is -1 left, 0 centre, 1 right; y is -1 top, 0 centre, 1 bottom
const ORIGINS = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [0, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

let plans = [];   // each photo's current move

function zoomPanEffect (i) {
  const loop = photos.length * STEP;
  const since = seconds + STEP - i * STEP + loop;

  const appearance = floor(since / loop); // 1st, 2nd, 3rd time on screen...
  const progress = constrain(((since % loop) - (STEP - CHANGE)) / (CHANGE + STEP), 0, 1);

  if (!plans[i] || plans[i].appearance !== appearance) {
    plans[i] = {
      appearance,
      zoomIn: random() < 0.5,
      origin: random(ORIGINS)
    };
  }
  const plan = plans[i];

  let zoom = lerp(ZOOM_MAX, ZOOM_MIN, progress);                // zoom out
  if (plan.zoomIn) zoom = lerp(ZOOM_MIN, ZOOM_MAX, progress);   // zoom in

  const spareX = (width * (zoom - 1)) / 2;
  const spareY = (height * (zoom - 1)) / 2;

  return {
    zoom,
    x: -plan.origin[0] * spareX,
    y: -plan.origin[1] * spareY
  };
}

//melt effect
const MELT = 0.3;  
const WAVE = 1;    

// which way a melt can drip: x is -1 left, 1 right; y is -1 up, 1 down
const DIRECTIONS = [
  [0, 1], [0, -1], [-1, 0], [1, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

let meltShader;
let meltTurn;
let meltDirection = [0, 1];

function meltEffect (current, next, t) {
  // new turn: pick a direction. Nothing is melted then, so the change cannot be seen.
  const turn = floor(seconds / STEP);
  if (turn !== meltTurn) {
    meltTurn = turn;
    const [dx, dy] = random(DIRECTIONS);
    const length = sqrt(dx * dx + dy * dy);
    meltDirection = [dx / length, dy / length];
  }

  shader(meltShader);
  meltShader.setUniform('photoA', photos[current]);
  meltShader.setUniform('photoB', photos[next]);
  meltShader.setUniform('rectA', photoRect(current));
  meltShader.setUniform('rectB', photoRect(next));
  meltShader.setUniform('size', [width, height]);
  meltShader.setUniform('melt', MELT);
  meltShader.setUniform('wave', WAVE);
  meltShader.setUniform('direction', meltDirection);
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
  // eased so the melt starts and ends softly
  float t = progress * progress * (3.0 - 2.0 * progress);

  // A drips away the whole change. B fades in over most of it, pulled
  // back the other way at first and dripping into place.
  float swap = smoothstep(0.15, 0.95, t);
  vec2 a = (melted(pos, melt * t * 0.7, t) * size - rectA.xy) / rectA.zw;
  vec2 b = (melted(pos, -melt * (1.0 - swap) * 0.5, t) * size - rectB.xy) / rectB.zw;

  gl_FragColor = mix(texture2D(photoA, a), texture2D(photoB, b), swap);
}`;

// A module keeps its functions to itself, so hand them to p5 and start it in global mode
Object.assign(window, { preload, setup, draw, windowResized });
new p5();
