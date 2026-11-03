/** Reference Figma defaults: 4 px dots, 1.05 scale, CMYK, -180°. */
export const DEFAULT_PARAMS = Object.freeze({
  dotSize: 4,
  dotScale: 1.05,
  softness: 0,
  rotation: -180, // degrees; converted to radians by the surface
  center: [0.1, 0.1],
  halftoneType: 0, // 0 = dot, 1 = blended
  colorMode: 0, // 0 = CMYK, 1 = RGB, 2 = BW light, 3 = BW dark
  clipToAlpha: false,
  designWidth: 399,
  designHeight: null,
  renderScale: 2,
  negative: false,
  pattern: {
    on: 'image', // image | color | original
    paper: '#ccd391',
    blend: 'multiply', // multiply | darken | overlay | screen | normal
    opacity: 1,
  },
  gradient: null,
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
  if (value && typeof value === 'object' && !Array.isArray(value) && 'r' in value) {
    return [
      clamp(numberOr(value.r, 0), 0, 1),
      clamp(numberOr(value.g, 0), 0, 1),
      clamp(numberOr(value.b, 0), 0, 1),
    ];
  }
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

function colorToUnitRGBA(value) {
  const rgb = colorToUnitRGB(value);
  if (!rgb) return null;
  const alpha = value && typeof value === 'object' && !Array.isArray(value) && value.a != null
    ? clamp(numberOr(value.a, 1), 0, 1)
    : 1;
  return [...rgb, alpha];
}

function normalizeHalftoneType(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'string') return value.toLowerCase() === 'blended' ? 1 : 0;
  return numberOr(value, fallback) ? 1 : 0;
}

function normalizeColorMode(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'string') {
    const mode = value.toLowerCase().replace(/[\s_]/g, '-');
    if (mode === 'rgb') return 1;
    if (mode === 'bw-light' || mode === 'bwlight') return 2;
    if (mode === 'bw-dark' || mode === 'bwdark') return 3;
    return 0;
  }
  return clamp(Math.round(numberOr(value, fallback)), 0, 3);
}

function normalizeCenter(value, base) {
  if (value === undefined) return [...base];
  if (Array.isArray(value)) {
    return [clamp(numberOr(value[0], 0.5), 0, 1), clamp(numberOr(value[1], 0.5), 0, 1)];
  }
  if (value && typeof value === 'object') {
    const x = numberOr(value.x, 50);
    const y = numberOr(value.y, 50);
    return [clamp(x / 100, 0, 1), clamp(y / 100, 0, 1)];
  }
  return [...base];
}

function normalizeRepeat(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return clamp(Math.round(value), 0, 2);
  const repeat = String(value).toLowerCase();
  if (repeat === 'repeat') return 1;
  if (repeat === 'mirror') return 2;
  return 0;
}

function normalizeMixSpace(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return clamp(Math.round(value), 0, 2);
  const space = String(value).toLowerCase();
  if (space === 'linear') return 1;
  if (space === 'oklab') return 2;
  return 0;
}

function normalizeGradient(input, base) {
  if (input === undefined) return base ? { ...base } : null;
  if (input === null || input === false) return null;
  if (input === true) return base ? { ...base } : null;

  let rawStops = [];
  if (typeof input === 'string') {
    rawStops = input.split(',').map((part, index) => ({
      color: part.trim(),
      position: index === 0 ? 0 : 1,
    }));
  } else if (Array.isArray(input)) {
    rawStops = input.map((stop, index) => (
      stop && typeof stop === 'object' && !Array.isArray(stop)
        ? stop
        : { color: stop, position: index === 0 ? 0 : 1 }
    ));
  } else if (input && typeof input === 'object') {
    if (input.enabled === false) return null;
    if (Array.isArray(input.stops)) {
      rawStops = input.stops;
    } else if (input.dark != null || input.light != null || input.from != null || input.to != null) {
      rawStops = [
        { color: input.dark ?? input.from, position: 0 },
        { color: input.light ?? input.to, position: 1 },
      ];
    }
  }

  const stops = rawStops
    .map((stop, index) => {
      const value = stop && typeof stop === 'object' && 'color' in stop ? stop.color : stop;
      const color = colorToUnitRGBA(value);
      if (!color) return null;
      const position = stop && typeof stop === 'object' && 'position' in stop
        ? clamp(numberOr(stop.position, index), 0, 1)
        : clamp(index / Math.max(1, rawStops.length - 1), 0, 1);
      return { position, color };
    })
    .filter(Boolean)
    .sort((a, b) => a.position - b.position)
    .slice(0, 8);

  if (!stops.length) return base ? { ...base } : null;

  const options = input && typeof input === 'object' ? input : {};
  const fallback = base ?? {};
  const enabled = options.enabled !== false;

  return {
    enabled,
    stops,
    mixSpace: normalizeMixSpace(options.mixSpace, fallback.mixSpace ?? 0),
    repeat: normalizeRepeat(options.repeat, fallback.repeat ?? 0),
    scatter: clamp(numberOr(options.scatter, fallback.scatter ?? 0), 0, 100) / 100,
    offset: clamp(numberOr(options.offset, fallback.offset ?? 0), -100, 100) / 100,
    frequency: clamp(numberOr(options.frequency, fallback.frequency ?? 2), 1, 10),
  };
}

function normalizePattern(input, base) {
  const basePaper = Array.isArray(base.paper) ? base.paper : (colorToUnitRGB(base.paper) ?? [0.8, 0.83, 0.57]);
  if (input === undefined) return { ...base, paper: [...basePaper] };
  if (!input || typeof input !== 'object') return { ...base, paper: [...basePaper] };
  const on = typeof input.on === 'string' && ['image', 'color', 'original'].includes(input.on)
    ? input.on
    : base.on;
  const blend = typeof input.blend === 'string' &&
    ['multiply', 'darken', 'overlay', 'screen', 'normal'].includes(input.blend)
    ? input.blend
    : base.blend;
  const paperRGB = colorToUnitRGB(input.paper) ?? basePaper;
  return {
    on,
    paper: [...paperRGB],
    blend,
    opacity: clamp(numberOr(input.opacity, base.opacity), 0, 1),
  };
}

/** Normalize partial params, falling back to base for omitted fields. */
export function normalizeParams(input = {}, base = DEFAULT_PARAMS) {
  const value = input || {};
  const center = value.center ?? value.centerPos ?? (value.centerX != null || value.centerY != null
    ? { x: value.centerX, y: value.centerY }
    : base.center);
  const gradient = value.gradient !== undefined
    ? normalizeGradient(value.gradient, base.gradient)
    : normalizeGradient(base.gradient, null);
  return {
    dotSize: clamp(numberOr(value.dotSize, base.dotSize), 0.2, 400),
    dotScale: clamp(numberOr(value.dotScale, base.dotScale), 0, 2),
    softness: clamp(numberOr(value.softness, base.softness), 0, 1),
    rotation: clamp(numberOr(value.rotation, base.rotation), -180, 180),
    center: normalizeCenter(center, base.center),
    halftoneType: normalizeHalftoneType(value.halftoneType, base.halftoneType),
    colorMode: normalizeColorMode(value.colorMode, base.colorMode),
    clipToAlpha: boolOr(value.clipToAlpha, base.clipToAlpha),
    designWidth: Math.max(1, numberOr(value.designWidth, base.designWidth)),
    designHeight: value.designHeight == null
      ? base.designHeight
      : Math.max(1, numberOr(value.designHeight, base.designHeight ?? 1)),
    renderScale: clamp(numberOr(value.renderScale, base.renderScale), 0.5, 4),
    negative: boolOr(value.negative, base.negative),
    pattern: normalizePattern(value.pattern, base.pattern),
    gradient,
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
  if (dataset.halftoneColorMode) overrides.colorMode = dataset.halftoneColorMode;
  if (dataset.halftoneType) overrides.halftoneType = dataset.halftoneType;
  if (dataset.halftoneClip != null) overrides.clipToAlpha = dataset.halftoneClip !== 'false';
  if (dataset.halftoneDesignWidth) overrides.designWidth = Number(dataset.halftoneDesignWidth);
  if (dataset.halftoneCenter) {
    const parts = dataset.halftoneCenter.split(',').map(Number);
    if (parts.length === 2 && parts.every(Number.isFinite)) overrides.center = parts;
  }
  if (dataset.halftoneCenterX != null || dataset.halftoneCenterY != null) {
    overrides.centerPos = {
      x: Number(dataset.halftoneCenterX ?? 50),
      y: Number(dataset.halftoneCenterY ?? 50),
    };
  }
  if (dataset.halftoneNegative != null) overrides.negative = dataset.halftoneNegative !== 'false';
  if (dataset.halftonePatternOn) overrides.pattern = { on: dataset.halftonePatternOn };
  if (dataset.halftonePaper) {
    overrides.pattern = { ...(overrides.pattern || {}), paper: dataset.halftonePaper };
  }
  if (dataset.halftonePatternBlend) {
    overrides.pattern = { ...(overrides.pattern || {}), blend: dataset.halftonePatternBlend };
  }
  if (dataset.halftonePatternOpacity) {
    overrides.pattern = { ...(overrides.pattern || {}), opacity: Number(dataset.halftonePatternOpacity) };
  }

  const gradientAttr = dataset.halftoneGradient;
  if (gradientAttr) {
    const parts = gradientAttr.split(',').map((part) => part.trim()).filter(Boolean);
    overrides.gradient = {
      stops: parts.map((color, index) => ({
        color,
        position: index / Math.max(1, parts.length - 1),
      })),
    };
  }

  return normalizeParams(overrides, base);
}
