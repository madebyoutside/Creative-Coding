import gsap from 'gsap';

const logo = document.querySelector('.logo');
const form = document.querySelector('.controls');

// The letters as SVG text
const svgFiles = import.meta.glob('/src/assets/logos-svg/*.svg', { query: '?raw', import: 'default', eager: true });

const BAND_HEIGHT = 80; // height of a white band
const ROW_STEP = 88; // from the top of one band to the top of the next
const TIGHT_GAP = 11; // space between the letters of CREATIVES

const sum = (numbers) => numbers.reduce((total, n) => total + n, 0); // adding the letters's widths and gaps to get the total width of a row


// Build the logo 

// The first two words get random spacing, the last two stay fixed
const rows = ['HUMAN', 'FIRST', 'CREATIVES', 'COALITION'].map((word, i) => ({
  random: i < 2,
  svgs: [...word].map((char) => svgFiles[`/src/assets/logos-svg/${char}.svg`]),
}));

// Read each letter's width and height 
rows.forEach((row) => {
  row.sizes = row.svgs.map((svg) => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number));
  row.widths = row.sizes.map(([width]) => width);
});

// The logo is exactly as wide as CREATIVES
const LOGO_WIDTH = sum(rows[2].widths) + TIGHT_GAP * (rows[2].widths.length - 1);
const LOGO_HEIGHT = ROW_STEP * (rows.length - 1) + BAND_HEIGHT;

// Everything is placed in %, so the logo scales with its CSS width
const percent = (value, of) => `${(value / of) * 100}%`;

logo.style.aspectRatio = `${LOGO_WIDTH} / ${LOGO_HEIGHT}`;

rows.forEach((row, i) => {
  // For the white bands
  row.band = document.createElement('div');
  row.band.className = 'band';
  row.band.style.top = percent(i * ROW_STEP, LOGO_HEIGHT);
  row.band.style.height = percent(BAND_HEIGHT, LOGO_HEIGHT);
  logo.append(row.band);

  // For the letters with the SVG inside
  row.letters = row.svgs.map((svg, j) => {
    const [width, height] = row.sizes[j];
    const letter = document.createElement('span');
    letter.className = 'letter';
    letter.innerHTML = svg;
    letter.style.width = percent(width, LOGO_WIDTH);
    letter.style.top = percent((BAND_HEIGHT - height) / 2, BAND_HEIGHT); // centred in the band
    row.band.append(letter);
    return letter;
  });
});


// ---------- Spacing ----------

function makeGaps(row, style) {
  const count = row.widths.length - 1; // how many gaps there are between the letters
  const space = LOGO_WIDTH - sum(row.widths); // how much space is left over for the gaps

  // evenly spaced
  if (style === 'even') {
    return Array(count).fill(space / count); 
  }

  // smallest gap
  const minGap = Math.min(settings.minGap, space / count);

  // packed: all gaps are the minimum, so the letters are as close together as possible
  if (style === 'packed') {
    return Array(count).fill(minGap);
  }

  // random: give each gap a random share of the space left over.
  const shares = Array.from({ length: count }, () => Math.random() ** settings.power);
  const leftover = space - minGap * count;
  return shares.map((share) => minGap + leftover * (share / sum(shares)));
}

// Where each letter goes, walking left to right.
// Given as a % of the letter's own width, because that's how a transform measures %
function letterPositions(row, gaps) {
  let x = 0;
  return row.widths.map((width, i) => {
    const xPercent = (x / width) * 100;
    x += width + (gaps[i] ?? 0); // step past this letter and its gap (the last letter has none)
    return xPercent;
  });
}

// Place the letters according to the lettersPositions and makeGaps
function placeLetters(row, gapStyle) {
  const positions = letterPositions(row, makeGaps(row, gapStyle));
  gsap.set(row.letters, { xPercent: (i) => positions[i] });
}


// ---------- Animation ----------

// How each letter appears: [from, to]
const appearances = {
  fade: () => [{ 
    opacity: 0 
  }, { 
    opacity: 1, 
    ease: 'steps(1)' 
  }], // jumps straight from 0 to 1, no in-between
  clip: () => [
    { clipPath: 'inset(-10% 100% -10% 0%)', 
      rotate: settings.tilt, 
      transformOrigin: '0% 100%' 
    },
    { 
      clipPath: 'inset(-10% 0% -10% 0%)', 
      rotate: 0 },
  ],
};

let reveal; // the appearance timeline
let nextShuffle; // the timer for the auto shuffle

// Slide the letters of HUMAN and FIRST to new random spacing
function shuffleAnimation() {
  const timeline = gsap.timeline();

  rows.filter((row) => row.random).forEach((row, i) => {
    const positions = letterPositions(row, makeGaps(row, 'random'));
    timeline.to(row.letters, {
      xPercent: (j) => positions[j],
      duration: settings.shuffleDuration,
      ease: 'power3.inOut',
    }, i * 0.08); // FIRST starts a moment after HUMAN
  });

  return timeline;
}

// Once the logo has appeared, keep shuffling every few seconds
function scheduleShuffle() {
  if (settings.interval > 0) {
    nextShuffle = gsap.delayedCall(settings.shuffleDuration + settings.interval, () => {
      shuffleAnimation();
      scheduleShuffle();
    });
  }
}

function play() {
  // stop the previous run and clear what it left on the letters
  reveal?.kill();
  nextShuffle?.kill();
  const allLetters = rows.flatMap((row) => row.letters);
  gsap.killTweensOf(allLetters);
  gsap.set(allLetters, { 
    clearProps: 'opacity,clipPath,rotate,transform' 
  });
  rows.forEach((row) => placeLetters(row, row.random ? settings.start : 'even'));

  reveal = gsap.timeline({ 
    delay: settings.delay, 
    onComplete: scheduleShuffle 
  });

  // the white bands draw in from the left
  reveal.fromTo(rows.map((row) => row.band), { 
    scaleX: 0, 
    transformOrigin: 'left' 
  }, {
    scaleX: 1,
    duration: 0.6,
    stagger: 0.1,
    ease: 'power3.inOut',
  });

  // the words appear one after another, top to bottom
  const [from, to] = appearances[settings.animation]();

  rows.forEach((row, i) => {
    reveal.fromTo(row.letters, from, {
      ease: 'none', // before ...to, so the fade's own ease wins
      ...to,
      duration: settings.duration,
      stagger: settings.letters === 'wipe' ? settings.stagger : 0, // letter by letter, or the whole word at once
    }, 0.3 + i * settings.wordDelay);
  });

  // HUMAN and FIRST break apart into random spacing
  reveal.add(shuffleAnimation(), '+=0.15');

  // skip straight to the end for people who prefer less motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    reveal.progress(1);
    nextShuffle?.kill();
  }

  logo.style.visibility = 'visible';
}


// ---------- Settings panel ----------

let settings;

function readSettings() {
  form.querySelectorAll('output').forEach((output) => {
    output.value = output.previousElementSibling.value;
  });

  settings = {};
  new FormData(form).forEach((value, name) => {
    settings[name] = isNaN(value) ? value : Number(value);
  });
}

function update() {
  readSettings();
  play();
}

form.addEventListener('input', update);
form.addEventListener('reset', () => setTimeout(update)); 

update();
