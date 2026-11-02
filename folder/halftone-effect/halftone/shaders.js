import { Filter, GlProgram, GpuProgram, UniformGroup } from 'pixi.js';

// WGSL halftone: one blur sample per ink, then coverage, gradient and negative.
const WGSL = /* wgsl */ `
diagnostic(off, derivative_uniformity);

struct GlobalFilterUniforms {
  uInputSize: vec4<f32>,
  uInputPixel: vec4<f32>,
  uInputClamp: vec4<f32>,
  uOutputFrame: vec4<f32>,
  uGlobalFrame: vec4<f32>,
  uOutputTexture: vec4<f32>,
};

struct HalftoneUniforms {
  p0: vec4<f32>,
  p1: vec4<f32>,
  p2: vec4<f32>, // gradient dark rgb, enabled
  p3: vec4<f32>, // gradient light rgb, blend (0 replace, 1 multiply)
  p4: vec4<f32>, // page multiply rgb, enabled
  p5: vec4<f32>, // negative, reserved
};

@group(0) @binding(0) var<uniform> gfu: GlobalFilterUniforms;
@group(1) @binding(0) var<uniform> halftoneUniforms: HalftoneUniforms;
@group(1) @binding(1) var uBlur: texture_2d<f32>;
@group(1) @binding(2) var uBlurSampler: sampler;

const INV_PI: f32 = 0.31830988618;

struct VSOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec2<f32>,
};

fn filterVertexPosition(aPosition: vec2<f32>) -> vec4<f32> {
  var position = aPosition * gfu.uOutputFrame.zw + gfu.uOutputFrame.xy;
  position.x = position.x * (2.0 / gfu.uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * gfu.uOutputTexture.z / gfu.uOutputTexture.y) - gfu.uOutputTexture.z;
  return vec4<f32>(position, 0.0, 1.0);
}

@vertex
fn mainVertex(@location(0) aPosition: vec2<f32>) -> VSOutput {
  var out: VSOutput;
  out.position = filterVertexPosition(aPosition);
  out.local = aPosition * gfu.uOutputFrame.zw;
  return out;
}

fn srgbToLinear(c: vec3<f32>) -> vec3<f32> {
  // Cubic sRGB EOTF; close enough for dot radii and cheaper than pow.
  return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878);
}

fn rot2(t: f32) -> mat2x2<f32> {
  let c = cos(t);
  let s = sin(t);
  return mat2x2<f32>(c, -s, s, c);
}

fn localPosToGrid(p: vec2<f32>, theta: f32, center: vec2<f32>, dotSize: f32) -> vec2<f32> {
  return rot2(theta) * (p - center) * (1.0 / dotSize);
}

fn gridToLocalPos(p: vec2<f32>, theta: f32, center: vec2<f32>, dotSize: f32) -> vec2<f32> {
  return rot2(-theta) * (p * dotSize) + center;
}

fn dotRadius(luma: f32) -> f32 {
  if (luma <= 0.0) {
    return 0.0;
  }
  var rad = sqrt(luma * INV_PI);
  if (rad >= 0.5) {
    rad = (1.414 - pow(max(0.001, 1.0 - luma) / 1.673, 1.0 / 2.33)) * 0.5;
  }
  return rad;
}

fn cmykRadius(index: i32, rgb: vec3<f32>, alpha: f32, dotScale: f32) -> f32 {
  let k = 1.0 - max(rgb.r, max(rgb.g, rgb.b));
  if (k >= 1.0) {
    return select(0.0, dotRadius(alpha) * dotScale, index == 3);
  }
  let inv = 1.0 / (1.0 - k);
  var value = k;
  if (index == 0) {
    value = (1.0 - rgb.r - k) * inv;
  } else if (index == 1) {
    value = (1.0 - rgb.g - k) * inv;
  } else if (index == 2) {
    value = (1.0 - rgb.b - k) * inv;
  }
  return dotRadius(value * alpha) * dotScale;
}

fn rgbRadius(index: i32, rgb: vec3<f32>, alpha: f32, dotScale: f32) -> f32 {
  var value = rgb.b;
  if (index == 0) {
    value = rgb.r;
  } else if (index == 1) {
    value = rgb.g;
  }
  return dotRadius(value * alpha) * dotScale;
}

// One blur sample per ink, reused for the 3x3 coverage tests around the dot.
fn sampleInk(gridPos: vec2<f32>, theta: f32, center: vec2<f32>, dotSize: f32, dims: vec2<f32>) -> vec4<f32> {
  let cell = floor(gridPos + vec2<f32>(0.5));
  let localPos = gridToLocalPos(cell, theta, center, dotSize);
  let uv = clamp(localPos / dims, vec2<f32>(0.0), vec2<f32>(1.0));
  let rgba = textureSampleLevel(uBlur, uBlurSampler, uv, 0.0);
  var linear = vec3<f32>(0.0);
  if (rgba.a > 0.0001) {
    linear = srgbToLinear(rgba.rgb / rgba.a);
    // Invert the source before the dots, so the halftone pattern negates too.
    if (halftoneUniforms.p5.x > 0.5) {
      linear = vec3<f32>(1.0) - linear;
    }
  }
  return vec4<f32>(linear, rgba.a);
}

fn inkCoverage(rad: f32, gridPos: vec2<f32>, softness: f32) -> f32 {
  let cell = floor(gridPos + vec2<f32>(0.5));
  let aa = max(length(fwidth(gridPos)) * 0.5, 0.001);
  let inner = rad * (1.0 - softness) - aa;
  let outer = rad * (1.0 + softness) + aa;
  var sum = 0.0;
  for (var oy = -1; oy <= 1; oy = oy + 1) {
    for (var ox = -1; ox <= 1; ox = ox + 1) {
      let offset = vec2<f32>(f32(ox), f32(oy));
      let dist = length(gridPos - (cell + offset));
      sum = sum + (1.0 - smoothstep(inner, outer, dist));
    }
  }
  return min(sum, 1.0);
}

fn cmykDot(localPos: vec2<f32>, theta: f32, center: vec2<f32>, dotSize: f32, dims: vec2<f32>, softness: f32, dotScale: f32, index: i32) -> f32 {
  let gridPos = localPosToGrid(localPos, theta, center, dotSize);
  let ink = sampleInk(gridPos, theta, center, dotSize, dims);
  return inkCoverage(cmykRadius(index, ink.rgb, ink.a, dotScale), gridPos, softness);
}

fn rgbDot(localPos: vec2<f32>, theta: f32, center: vec2<f32>, dotSize: f32, dims: vec2<f32>, softness: f32, dotScale: f32, index: i32) -> f32 {
  let gridPos = localPosToGrid(localPos, theta, center, dotSize);
  let ink = sampleInk(gridPos, theta, center, dotSize, dims);
  return inkCoverage(rgbRadius(index, ink.rgb, ink.a, dotScale), gridPos, softness);
}

fn cmykToRgb(cmyk: vec4<f32>) -> vec3<f32> {
  return vec3<f32>(
    (1.0 - cmyk.x) * (1.0 - cmyk.w),
    (1.0 - cmyk.y) * (1.0 - cmyk.w),
    (1.0 - cmyk.z) * (1.0 - cmyk.w)
  );
}

@fragment
fn mainFragment(@location(0) local: vec2<f32>) -> @location(0) vec4<f32> {
  let dotSize = max(halftoneUniforms.p0.x, 1.0);
  let dotScale = max(halftoneUniforms.p0.y, 0.0);
  let softness = clamp(halftoneUniforms.p0.z, 0.0, 1.0);
  let rotation = halftoneUniforms.p0.w;
  let dims = gfu.uOutputFrame.zw;
  let center = vec2<f32>(
    clamp(halftoneUniforms.p1.x, 0.0, 1.0),
    clamp(halftoneUniforms.p1.y, 0.0, 1.0)
  ) * dims;
  let colorMode = i32(halftoneUniforms.p1.z + 0.5);
  let reveal = clamp(halftoneUniforms.p1.w, 0.0, 1.0);

  let rad15 = 0.2617993878;
  let rad45 = 0.7853981634;
  let rad75 = 1.3089969390;

  var color = vec3<f32>(0.0);

  if (colorMode == 0) {
    let cover = vec4<f32>(
      cmykDot(local, rotation + rad15, center, dotSize, dims, softness, dotScale, 0),
      cmykDot(local, rotation + rad75, center, dotSize, dims, softness, dotScale, 1),
      cmykDot(local, rotation, center, dotSize, dims, softness, dotScale, 2),
      cmykDot(local, rotation + rad45, center, dotSize, dims, softness, dotScale, 3)
    );
    color = cmykToRgb(cover);
  } else {
    color = vec3<f32>(
      rgbDot(local, rotation + rad15, center, dotSize, dims, softness, dotScale, 0),
      rgbDot(local, rotation + rad75, center, dotSize, dims, softness, dotScale, 1),
      rgbDot(local, rotation, center, dotSize, dims, softness, dotScale, 2)
    );
  }

  // Map the printed luminance through the two-stop gradient.
  if (halftoneUniforms.p2.w > 0.5) {
    let luma = clamp(dot(color, vec3<f32>(0.299, 0.587, 0.114)), 0.0, 1.0);
    let mapped = mix(halftoneUniforms.p2.rgb, halftoneUniforms.p3.rgb, luma);
    if (halftoneUniforms.p3.w > 0.5) {
      color = color * mapped;
    } else {
      color = mapped;
    }
  }

  if (halftoneUniforms.p4.w > 0.5) {
    color = color * halftoneUniforms.p4.rgb;
  }

  return vec4<f32>(color * reveal, reveal);
}
`;

// GLSL vertex/fragment mirrors of the WGSL filter for the WebGL2 fallback.
const GLSL_VERT = /* glsl */ `#version 300 es
precision highp float;

in vec2 aPosition;
out vec2 vLocal;

uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

void main() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vLocal = aPosition * uOutputFrame.zw;
}
`;

const GLSL_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vLocal;
out vec4 finalColor;

uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
uniform sampler2D uBlur;
uniform vec4 p0;
uniform vec4 p1;
uniform vec4 p2;
uniform vec4 p3;
uniform vec4 p4;
uniform vec4 p5;

const float INV_PI = 0.31830988618;

mat2 rot2(float t) {
  float c = cos(t);
  float s = sin(t);
  return mat2(c, -s, s, c);
}

vec2 localPosToGrid(vec2 p, float theta, vec2 center, float dotSize) {
  return rot2(theta) * (p - center) * (1.0 / dotSize);
}

vec2 gridToLocalPos(vec2 p, float theta, vec2 center, float dotSize) {
  return rot2(-theta) * (p * dotSize) + center;
}

float dotRadius(float luma) {
  if (luma <= 0.0) return 0.0;
  float rad = sqrt(luma * INV_PI);
  if (rad >= 0.5) {
    rad = (1.414 - pow(max(0.001, 1.0 - luma) / 1.673, 1.0 / 2.33)) * 0.5;
  }
  return rad;
}

float cmykRadius(int index, vec3 rgb, float alpha, float dotScale) {
  float k = 1.0 - max(rgb.r, max(rgb.g, rgb.b));
  if (k >= 1.0) {
    return index == 3 ? dotRadius(alpha) * dotScale : 0.0;
  }
  float inv = 1.0 / (1.0 - k);
  float value = k;
  if (index == 0) value = (1.0 - rgb.r - k) * inv;
  else if (index == 1) value = (1.0 - rgb.g - k) * inv;
  else if (index == 2) value = (1.0 - rgb.b - k) * inv;
  return dotRadius(value * alpha) * dotScale;
}

float rgbRadius(int index, vec3 rgb, float alpha, float dotScale) {
  float value = rgb.b;
  if (index == 0) value = rgb.r;
  else if (index == 1) value = rgb.g;
  return dotRadius(value * alpha) * dotScale;
}

vec3 srgbToLinear(vec3 c) {
  return c * (c * (c * 0.305306011 + 0.682171111) + 0.012522878);
}

vec4 sampleInk(vec2 gridPos, float theta, vec2 center, float dotSize, vec2 dims) {
  vec2 cell = floor(gridPos + vec2(0.5));
  vec2 localPos = gridToLocalPos(cell, theta, center, dotSize);
  vec2 uv = clamp(localPos / dims, vec2(0.0), vec2(1.0));
  vec4 rgba = textureLod(uBlur, uv, 0.0);
  vec3 linear = vec3(0.0);
  if (rgba.a > 0.0001) {
    linear = srgbToLinear(rgba.rgb / rgba.a);
    if (p5.x > 0.5) linear = vec3(1.0) - linear;
  }
  return vec4(linear, rgba.a);
}

float inkCoverage(float rad, vec2 gridPos, float softness) {
  vec2 cell = floor(gridPos + vec2(0.5));
  float aa = max(length(fwidth(gridPos)) * 0.5, 0.001);
  float inner = rad * (1.0 - softness) - aa;
  float outer = rad * (1.0 + softness) + aa;
  float sum = 0.0;
  for (int oy = -1; oy <= 1; oy++) {
    for (int ox = -1; ox <= 1; ox++) {
      float dist = length(gridPos - (cell + vec2(float(ox), float(oy))));
      sum += 1.0 - smoothstep(inner, outer, dist);
    }
  }
  return min(sum, 1.0);
}

float cmykDot(vec2 localPos, float theta, vec2 center, float dotSize, vec2 dims, float softness, float dotScale, int index) {
  vec2 gridPos = localPosToGrid(localPos, theta, center, dotSize);
  vec4 ink = sampleInk(gridPos, theta, center, dotSize, dims);
  return inkCoverage(cmykRadius(index, ink.rgb, ink.a, dotScale), gridPos, softness);
}

float rgbDot(vec2 localPos, float theta, vec2 center, float dotSize, vec2 dims, float softness, float dotScale, int index) {
  vec2 gridPos = localPosToGrid(localPos, theta, center, dotSize);
  vec4 ink = sampleInk(gridPos, theta, center, dotSize, dims);
  return inkCoverage(rgbRadius(index, ink.rgb, ink.a, dotScale), gridPos, softness);
}

vec3 cmykToRgb(vec4 cmyk) {
  return vec3(
    (1.0 - cmyk.x) * (1.0 - cmyk.w),
    (1.0 - cmyk.y) * (1.0 - cmyk.w),
    (1.0 - cmyk.z) * (1.0 - cmyk.w)
  );
}

void main() {
  float dotSize = max(p0.x, 1.0);
  float dotScale = max(p0.y, 0.0);
  float softness = clamp(p0.z, 0.0, 1.0);
  float rotation = p0.w;
  vec2 dims = uOutputFrame.zw;
  vec2 center = clamp(p1.xy, vec2(0.0), vec2(1.0)) * dims;
  int colorMode = int(p1.z + 0.5);
  float reveal = clamp(p1.w, 0.0, 1.0);

  const float rad15 = 0.2617993878;
  const float rad45 = 0.7853981634;
  const float rad75 = 1.3089969390;

  vec3 color = vec3(0.0);

  if (colorMode == 0) {
    vec4 cover = vec4(
      cmykDot(vLocal, rotation + rad15, center, dotSize, dims, softness, dotScale, 0),
      cmykDot(vLocal, rotation + rad75, center, dotSize, dims, softness, dotScale, 1),
      cmykDot(vLocal, rotation, center, dotSize, dims, softness, dotScale, 2),
      cmykDot(vLocal, rotation + rad45, center, dotSize, dims, softness, dotScale, 3)
    );
    color = cmykToRgb(cover);
  } else {
    color = vec3(
      rgbDot(vLocal, rotation + rad15, center, dotSize, dims, softness, dotScale, 0),
      rgbDot(vLocal, rotation + rad75, center, dotSize, dims, softness, dotScale, 1),
      rgbDot(vLocal, rotation, center, dotSize, dims, softness, dotScale, 2)
    );
  }

  if (p2.w > 0.5) {
    float luma = clamp(dot(color, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    vec3 mapped = mix(p2.rgb, p3.rgb, luma);
    if (p3.w > 0.5) {
      color = color * mapped;
    } else {
      color = mapped;
    }
  }

  if (p4.w > 0.5) {
    color = color * p4.rgb;
  }

  finalColor = vec4(color * reveal, reveal);
}
`;

let gpuProgram = null;
let glProgram = null;

/** Compile and cache the WGSL/GLSL programs once. */
function ensurePrograms() {
  if (gpuProgram) return;
  gpuProgram = GpuProgram.from({
    vertex: { source: WGSL, entryPoint: 'mainVertex' },
    fragment: { source: WGSL, entryPoint: 'mainFragment' },
  });
  glProgram = GlProgram.from({
    vertex: GLSL_VERT,
    fragment: GLSL_FRAG,
    name: 'halftone-filter',
  });
}

/** Packed uniforms shared by the WGSL and GLSL programs. */
export function createUniformGroup() {
  return new UniformGroup({
    p0: { value: new Float32Array([4, 1.05, 0, 0]), type: 'vec4<f32>' },
    p1: { value: new Float32Array([0.1, 0.1, 0, 1]), type: 'vec4<f32>' },
    p2: { value: new Float32Array([0.5098, 0.7569, 0.7529, 0]), type: 'vec4<f32>' },
    p3: { value: new Float32Array([1, 1, 1, 0]), type: 'vec4<f32>' },
    p4: { value: new Float32Array([1, 1, 1, 0]), type: 'vec4<f32>' },
    p5: { value: new Float32Array([0, 0, 0, 0]), type: 'vec4<f32>' },
  });
}

/** Build a Pixi filter for the active renderer backend. */
export function createHalftoneFilter({ resolution, blurTexture, uniforms }) {
  ensurePrograms();
  return new Filter({
    gpuProgram,
    glProgram,
    resources: {
      halftoneUniforms: uniforms,
      uBlur: blurTexture.source,
      uBlurSampler: blurTexture.source.style,
    },
    resolution,
    padding: 0,
    antialias: 'off',
    clipToViewport: false,
  });
}

