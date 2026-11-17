const TILE = 256; // size of the fill texture tile in px, repeated across the text
const EDGE_TILE = 256; // size of the edge noise tile in px

// draw tiles at the screen's real resolution, so they don't look blurry
const density = window.devicePixelRatio || 1;

const form = document.querySelector('.controls');
const edge = {
  spread: document.querySelector('#rough-edge .spread'), // feGaussianBlur on the letter shape
  noise: document.querySelector('#rough-edge .noise'), // feImage
  ink: document.querySelector('#rough-edge .ink'), // feFlood, the colour of the blobs
  soften: document.querySelector('#rough-edge .soften'), // feGaussianBlur
};

const underImage = document.querySelector('.under-image');
const defaultImage = underImage.src;

let settings;

const lerp = (a, b, t) => a + (b - a) * t; // blend two numbers
const clamp = (value) => Math.min(Math.max(value, 0), 1);
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); // color code to number: '#1c221c' → [28, 34, 28]


// ---------- Fill texture ----------

// Gaussian blur that wraps around the edges, so the tile repeats without seams
function blur(values, size, radius) {
  const reach = Math.ceil(radius * 2);
  const weights = [];
  for (let k = -reach; k <= reach; k++) {
    weights.push(Math.exp(-(k * k) / (2 * radius * radius)));
  }

  // blur across, then down
  const pass = (source, across) => {
    const result = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let total = 0;
        for (let k = -reach; k <= reach; k++) {
          const sx = across ? (x + k + size) % size : x;
          const sy = across ? y : (y + k + size) % size;
          total += source[sy * size + sx] * weights[k + reach];
        }
        result[y * size + x] = total;
      }
    }
    return result;
  };
  return pass(pass(values, true), false);
}

// Random noise blurred into soft blobs (bigger radius = bigger blobs).
// Then spread evenly from 0 to 1, so Amount works the same at every grain size
function noise(size, radius) {
  let values = Float32Array.from({ length: size * size }, Math.random);
  if (radius >= 0.5) {
    values = blur(values, size, radius);
  }

  // put the pixels in order: darkest gets 0, lightest gets 1
  const order = [...values.keys()].sort((a, b) => values[a] - values[b]);
  const even = new Float32Array(values.length);
  order.forEach((pixel, rank) => {
    even[pixel] = rank / (order.length - 1);
  });
  return even;
}

let tileUrl = ''; 

// Draw the grain tile and show it through the letters
function makeTile() {
  const size = Math.round(TILE * density);
  const grain = noise(size, (settings.grainSize * density) / 2); // grain size is in CSS px
  const patches = settings.clumping > 0 ? noise(size, size / 40) : null; // big soft blobs, for clumping
  const ink = hexToRgb(settings.ink);
  const speck = hexToRgb(settings.speck);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);

  for (let i = 0; i < size * size; i++) {
    let value = grain[i];
    if (patches) {
      value = lerp(value, patches[i], settings.clumping); // gather the specks into patches
    }
    // how far this pixel turns from ink to speck colour, 0 to 1
    const t = clamp((value - (1 - settings.amount)) / settings.softness);
    image.data[i * 4] = lerp(ink[0], speck[0], t);
    image.data[i * 4 + 1] = lerp(ink[1], speck[1], t);
    image.data[i * 4 + 2] = lerp(ink[2], speck[2], t);
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);

  // Save the tile as a file in memory and pass a short link to it (blob:...) to the CSS.
  // Set on <html> so every .fill-text on the page can use it
  canvas.toBlob((file) => {
    URL.revokeObjectURL(tileUrl); // free the last tile
    tileUrl = URL.createObjectURL(file);
    document.documentElement.style.setProperty('--fill', `url(${tileUrl})`);
  });
}

// Wait until a slider pauses before redrawing, so dragging stays smooth
let pending;
function makeTileSoon() {
  clearTimeout(pending);
  pending = setTimeout(makeTile, 60);
}


// ---------- Rough edge ----------

// Blobby noise: random noise blurred into blobs the size of Edge size, in red. Squeezed to
// 0–0.95 so the solid middle of the letters always beats it and never gets holes
function makeEdgeNoise() {
  const size = Math.round(EDGE_TILE * density);
  const values = noise(size, (settings.edgeSize * density) / 2);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const image = context.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    image.data[i * 4] = values[i] * 0.95 * 255;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  edge.noise.setAttribute('href', canvas.toDataURL());
}

// Feed the settings into the SVG filter. A wider blur on the letter shape gives a wider
// band where the blobs break in and out
function updateEdge() {
  edge.spread.setAttribute('stdDeviation', settings.edgeRadius);
  edge.ink.setAttribute('flood-color', settings.ink);
  edge.soften.setAttribute('stdDeviation', settings.edgeBlur);
}


// ---------- Image under the text ----------

// Show the picked file in place of the default image
function showImage(file) {
  if (underImage.src.startsWith('blob:')) {
    URL.revokeObjectURL(underImage.src); // free the last picked file
  }
  underImage.src = file ? URL.createObjectURL(file) : defaultImage;
}


// ---------- Settings panel ----------

// Read every input in the form, turning number values into numbers
function readSettings() {
  form.querySelectorAll('output').forEach((output) => {
    output.value = output.previousElementSibling.value;
  });

  settings = {};
  new FormData(form).forEach((value, name) => {
    settings[name] = isNaN(value) ? value : Number(value);
  });
}

// Redraw everything: on load, Reset and New grain
function drawAll() {
  readSettings();
  makeEdgeNoise();
  updateEdge();
  makeTile();
}

form.addEventListener('input', (event) => {
  readSettings();
  const name = event.target.name;
  if (name === 'image') {
    showImage(event.target.files[0]);
  } else if (name === 'edgeSize') {
    makeEdgeNoise();
  } else if (name.startsWith('edge')) {
    updateEdge(); // the edge is a live SVG filter, no redraw needed
  } else {
    updateEdge(); // the blobs follow the ink colour
    makeTileSoon();
  }
});

form.addEventListener('reset', () => {
  showImage(null);
  setTimeout(drawAll); // wait for the form to reset its values first
});
form.querySelector('.regenerate').addEventListener('click', drawAll);

drawAll();
