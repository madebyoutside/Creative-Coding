/** Reference Figma defaults: 4 px dots, 1.05 scale, CMYK, -180°. */
export const DEFAULT_PARAMS = Object.freeze({
  dotSize: 4,
  dotScale: 1.05,
  softness: 0,
  rotation: 0,
  center: [0.1, 0.1],
  colorMode: 0, // 0 = CMYK, 1 = RGB
  gradient: null, // { dark: [r,g,b], light: [r,g,b], blend: 'replace' | 'multiply' }
  multiplyColor: null, // image layer multiplied with the page background, e.g. '#CAD48A'
  negative: false,
});

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolOr(value, fallback) {
  if (value === undefined) return fallback;
  return value === true || value === 'true' || value === '' || value === 1 || value === '1';
}

function colorToUnitRGB(value) {
  if (Array.isArray(value) && value.length >= 3) {
    return value.slice(0, 3).map((channel) => clamp(numberOr(channel, 0), 0, 1));
  }
  let hex = String(value ?? '').trim();
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function normalizeGradient(input, base) {
  if (input === undefined) {
    return base ? { dark: [...base.dark], light: [...base.light], blend: base.blend } : null;
  }
  if (input === null || input === false) return null;
  if (input === true) {
    return base ? { dark: [...base.dark], light: [...base.light], blend: base.blend } : null;
  }

  let dark = null;
  let light = null;
  let blend = null;

  if (typeof input === 'string') {
    const parts = input.split(',').map((part) => part.trim()).filter(Boolean);
    dark = parts[0];
    light = parts[1];
  } else if (Array.isArray(input)) {
    [dark, light] = input;
  } else if (typeof input === 'object') {
    if (input.enabled === false) return null;
    dark = input.dark ?? input.from ?? input[0];
    light = input.light ?? input.to ?? input[1];
    blend = input.blend;
  }

  const darkRGB = colorToUnitRGB(dark) ?? (base ? [...base.dark] : null);
  const lightRGB = colorToUnitRGB(light) ?? (base ? [...base.light] : null);
  if (!darkRGB || !lightRGB) return null;

  const resolvedBlend = blend === 'multiply' ? 'multiply' : blend === 'replace' ? 'replace' : (base?.blend ?? 'replace');
  return { dark: darkRGB, light: lightRGB, blend: resolvedBlend };
}

function normalizeColor(input, base) {
  if (input === undefined) return base ? [...base] : null;
  if (input === null || input === false) return null;
  return colorToUnitRGB(input) ?? (base ? [...base] : null);
}

/** Normalize partial params, falling back to base for omitted fields. */
export function normalizeParams(input = {}, base = DEFAULT_PARAMS) {
  const value = input || {};
  const center = Array.isArray(value.center) ? value.center : base.center;
  return {
    dotSize: clamp(numberOr(value.dotSize, base.dotSize), 4, 200),
    dotScale: clamp(numberOr(value.dotScale, base.dotScale), 0, 2),
    softness: clamp(numberOr(value.softness, base.softness), 0, 1),
    rotation: numberOr(value.rotation, base.rotation),
    center: [clamp(numberOr(center?.[0], 0.5), 0, 1), clamp(numberOr(center?.[1], 0.5), 0, 1)],
    colorMode: numberOr(value.colorMode, base.colorMode) === 1 ? 1 : 0,
    gradient: normalizeGradient(value.gradient, base.gradient),
    multiplyColor: normalizeColor(value.multiplyColor, base.multiplyColor),
    negative: boolOr(value.negative, base.negative),
  };
}

/** Read data-halftone-* overrides for the single-image hover API. */
export function paramsForElement(element, base) {
  const dataset = element?.dataset || {};
  const overrides = {};

  if (dataset.halftoneDotSize != null && dataset.halftoneDotSize !== '') {
    overrides.dotSize = Number(dataset.halftoneDotSize);
  }
  if (dataset.halftoneDotScale != null && dataset.halftoneDotScale !== '') {
    overrides.dotScale = Number(dataset.halftoneDotScale);
  }
  if (dataset.halftoneSoftness != null && dataset.halftoneSoftness !== '') {
    overrides.softness = Number(dataset.halftoneSoftness);
  }
  if (dataset.halftoneRotation != null && dataset.halftoneRotation !== '') {
    overrides.rotation = Number(dataset.halftoneRotation);
  }
  if (dataset.halftoneColorMode) {
    overrides.colorMode = dataset.halftoneColorMode.toLowerCase() === 'rgb' ? 1 : 0;
  }
  if (dataset.halftoneCenter) {
    const parts = dataset.halftoneCenter.split(',').map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) overrides.center = parts;
  }

  if (dataset.halftoneMultiply) overrides.multiplyColor = dataset.halftoneMultiply;
  if (dataset.halftoneNegative != null) overrides.negative = dataset.halftoneNegative !== 'false';

  const gradientAttr = dataset.halftoneGradient;
  const gradientBlend = dataset.halftoneGradientBlend;
  if (gradientAttr || gradientBlend) {
    const parts = gradientAttr ? gradientAttr.split(',').map((part) => part.trim()) : [];
    overrides.gradient = {
      dark: parts[0] ?? base.gradient?.dark,
      light: parts[1] ?? base.gradient?.light,
      blend: gradientBlend ?? base.gradient?.blend,
    };
  }

  return normalizeParams(overrides, base);
}
