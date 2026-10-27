import GUI from 'lil-gui';
import { DEFAULTS, EASES, MELT_DIRECTIONS, saveSettings } from './settings.js';

// The settings panel in the top right. Press H to hide or show it.
export function createControls(settings, library, currentPhoto) {
  addStyles();
  const gui = new GUI({ title: 'Settings  (H to hide)', width: 320 });
  const eases = Object.keys(EASES);
  const sliders = [];
  const save = () => saveSettings(settings);
  const slider = (folder, key, min, max, step, name) =>
    sliders.push(addSlider(folder, settings, key, { min, max, step, name, onChange: save }));

  const photos = gui.addFolder('Photos');
  const grid = document.createElement('div');
  grid.className = 'photo-grid';
  photos.$children.append(grid);
  photos.add(library, 'useDefaults').name('Include default photos').listen();
  photos.add({ add: () => pickFiles(library.add) }, 'add').name('Add photos…');
  photos.add({ replace: () => pickFiles(library.replace) }, 'replace').name('Replace all with…');
  photos.add({ reset: library.reset }, 'reset').name('Back to default photos');

  const timing = gui.addFolder('Timing');
  slider(timing, 'step', 1, 20, 0.1, 'Seconds per photo');
  slider(timing, 'change', 0.1, 20, 0.1, 'Change length (s)');
  slider(timing, 'speed', 0, 4, 0.05, 'Speed');
  timing.add(settings, 'paused').name('Pause');

  const melt = gui.addFolder('Melt');
  melt.add(settings, 'transitionEase', eases).name('Ease');
  slider(melt, 'melt', 0, 1, 0.01, 'Drip amount');
  slider(melt, 'wave', 0, 5, 0.05, 'Sway');
  melt.add(settings, 'meltDirection', ['random', ...Object.keys(MELT_DIRECTIONS)]).name('Direction');

  const zoom = gui.addFolder('Zoom & pan');
  slider(zoom, 'zoomMin', 1, 3, 0.01, 'Zoom min');
  slider(zoom, 'zoomMax', 1, 3, 0.01, 'Zoom max');
  zoom.add(settings, 'zoomEase', eases).name('Ease');
  zoom.add(settings, 'zoomDirection', ['random', 'in', 'out']).name('Direction');
  zoom.add(settings, 'pan').name('Pan');

  const blur = gui.addFolder('Blur');
  slider(blur, 'blur', 0, 20, 0.1, 'Blur (px)');
  slider(blur, 'blurScale', 0, 0.3, 0.005, 'Scale up');

  gui.add({ copy: () => copySettings(settings) }, 'copy').name('Copy settings');
  gui.add({
    reset: () => {
      Object.assign(settings, DEFAULTS);
      gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
      sliders.forEach((update) => update());
      save();
    },
  }, 'reset').name('Reset settings');

  gui.onChange(save);

  addEventListener('keydown', (event) => {
    if (event.key === 'h' || event.key === 'H') gui.show(gui._hidden);
  });

  // thumbnails of every photo in the loop; the one on screen is outlined
  function drawGrid() {
    grid.replaceChildren(...library.photos.map((photo) => {
      const tile = document.createElement('div');
      tile.className = 'photo-tile';
      tile.title = photo.isDefault ? `${photo.name} (default)` : photo.name;
      const img = document.createElement('img');
      img.src = photo.url;
      tile.append(img);
      if (!photo.isDefault) {
        const remove = document.createElement('button');
        remove.textContent = '×';
        remove.title = 'Remove';
        remove.onclick = () => library.remove(photo);
        tile.append(remove);
      }
      return tile;
    }));
  }

  setInterval(() => {
    [...grid.children].forEach((tile, i) => tile.classList.toggle('current', i === currentPhoto()));
  }, 200);

  return { refresh: drawGrid };
}

// A slider with a round handle and a filled track, plus a box to type an exact value
function addSlider(folder, settings, key, { min, max, step, name, onChange }) {
  const row = document.createElement('div');
  row.className = 'controller slider-controller';
  row.innerHTML = `<div class="name"></div><div class="widget"></div>`;
  row.querySelector('.name').textContent = name;

  const range = document.createElement('input');
  Object.assign(range, { type: 'range', min, max, step, className: 'round-slider' });
  const number = document.createElement('input');
  Object.assign(number, { type: 'number', min, max, step, className: 'slider-number' });
  row.querySelector('.widget').append(range, number);

  const decimals = (String(step).split('.')[1] ?? '').length;

  function update() {
    const value = settings[key];
    range.value = value;
    number.value = value.toFixed(decimals);
    range.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
  }

  function set(value) {
    if (Number.isNaN(value)) return;
    settings[key] = Math.min(max, Math.max(min, value));
    update();
    onChange();
  }

  range.oninput = () => set(+range.value);
  number.onchange = () => set(+number.value);

  folder.$children.append(row);
  update();
  return update;
}

function pickFiles(onFiles) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => onFiles([...input.files]);
  input.click();
}

// Puts the current settings on the clipboard, ready to paste into DEFAULTS in settings.js
function copySettings(settings) {
  const text = JSON.stringify({ ...settings, paused: false }, null, 2);
  navigator.clipboard.writeText(text).then(
    () => alert('Settings copied. Paste them into DEFAULTS in settings.js to keep them.'),
    () => console.log(text),
  );
}

function addStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .lil-gui .photo-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
      padding: 4px var(--padding);
    }
    .lil-gui .photo-tile {
      position: relative;
      aspect-ratio: 1;
      border-radius: 3px;
      overflow: hidden;
      outline: 2px solid transparent;
      outline-offset: -2px;
    }
    .lil-gui .photo-tile.current { outline-color: var(--number-color); }
    .lil-gui .photo-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .lil-gui .photo-tile button {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 16px;
      height: 16px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.7);
      color: #fff;
      font-size: 12px;
      line-height: 16px;
      cursor: pointer;
    }

    .lil-gui .slider-controller .widget { gap: 8px; }
    .lil-gui .round-slider {
      --fill: 50%;
      flex: 1;
      min-width: 0;
      height: 16px;
      margin: 0;
      background: transparent;
      cursor: pointer;
      -webkit-appearance: none;
      appearance: none;
    }
    .lil-gui .round-slider::-webkit-slider-runnable-track {
      height: 4px;
      border-radius: 2px;
      background: linear-gradient(to right, #3b82f6 var(--fill), rgba(255, 255, 255, 0.18) var(--fill));
    }
    .lil-gui .round-slider::-moz-range-track {
      height: 4px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.18);
    }
    .lil-gui .round-slider::-moz-range-progress {
      height: 4px;
      border-radius: 2px;
      background: #3b82f6;
    }
    .lil-gui .round-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      margin-top: -5px;
      border: 0;
      border-radius: 50%;
      background: #3b82f6;
    }
    .lil-gui .round-slider::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border: 0;
      border-radius: 50%;
      background: #3b82f6;
    }
    .lil-gui .round-slider:focus-visible { outline: none; }
    .lil-gui .round-slider:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.4); }
    .lil-gui .slider-number {
      width: 52px;
      flex: none;
      -moz-appearance: textfield;
    }
    .lil-gui .slider-number::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  `;
  document.head.append(style);
}
