// Every value the settings panel can change. These are the starting values:
// tune them in the panel, click "Copy settings", and paste the result here.
export const DEFAULTS = {
  // timing, in seconds
  step: 4,                  // how long each photo stays, change included
  change: 4,                // how long the change to the next photo takes
  speed: 1,                 // 1 = normal, 2 = twice as fast, 0 = frozen
  paused: false,

  // melt (the change between photos)
  transitionEase: 'smooth',
  melt: 0.3,                // how far the photos drip
  wave: 1,                  // how much the drips sway
  meltDirection: 'random',

  // zoom and pan
  zoomMin: 1.05,
  zoomMax: 1.4,
  zoomEase: 'linear',
  zoomDirection: 'random',
  pan: true,

  // blur, at its strongest in the middle of a change
  blur: 1.5,                // pixels
  blurScale: 0.05,          // 0.05 = 5% bigger
};

// t goes 0..1 in, eased value comes out
export const EASES = {
  linear: (t) => t,
  smooth: (t) => t * t * (3 - 2 * t),
  sine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  cubic: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  quart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  expo: (t) => {
    if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1;
    return t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2;
  },
  'ease in': (t) => t * t * t,
  'ease out': (t) => 1 - (1 - t) ** 3,
};

// which way a melt drips: x is -1 left, 1 right; y is -1 up, 1 down
export const MELT_DIRECTIONS = {
  down: [0, 1],
  up: [0, -1],
  left: [-1, 0],
  right: [1, 0],
};

// The panel remembers your last settings in this browser
const STORAGE_KEY = 'animation-cross-fade-melt-effect:settings:v3';

export function loadSettings() {
  const settings = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
    for (const key of Object.keys(DEFAULTS)) {
      if (key === 'paused' || !(key in saved)) continue;
      if (typeof saved[key] === typeof DEFAULTS[key]) settings[key] = saved[key];
    }
  } catch {
    // nothing saved yet, or storage blocked: start from DEFAULTS
  }
  return settings;
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // private window or storage blocked: settings just won't be remembered
  }
}
