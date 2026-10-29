import p5 from 'p5';
import fontFile from '/src/assets/fonts/Brut_Grotesque-Medium.otf';

const TEXT = 'If we lose our power what leverage do we have left?';

const LINE_HEIGHT = 1;
const LETTER_SPACING = -0.025;
const UNIT = 0.2;
const WORD_GAP = 3; //3 units of space between words
const LINE_HEIGHTS = [1, 1.2, 1.3];
const MAX_INDENT = 4;
const SPEED = 0.2; // how fast a hovered gap opens or closes (0 to 1)

// the effects you can pick from the dropdown
const RANDOM_SPACING = 'Random letter spacing';
const RANDOM_LAYOUT = 'Random spacing + line height';
const HOVER_SPACING = 'Hover to space letters';
const HOVER_SPREAD = 'Hover to space all letters';

let words = [];
let seed = 1; 
let effect = RANDOM_SPACING; 
let accessible = false; 
let spread = 0; 
let font;

function preload() {
  font = loadFont(fontFile);

  document.fonts.add(new FontFace('Brut Grotesque', `url(${fontFile})`));
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont(font);
  noStroke();

  const box = createInput(TEXT);
  box.position(20, windowHeight - 56);
  box.size(windowWidth - 440, 24);
  box.input(() => {
    readText(box.value());
  });

  // dropdown to pick the effect
  const effectMenu = createSelect();
  effectMenu.option(RANDOM_SPACING);
  effectMenu.option(RANDOM_LAYOUT);
  effectMenu.option(HOVER_SPACING);
  effectMenu.option(HOVER_SPREAD);
  effectMenu.position(windowWidth - 400, windowHeight - 54);
  effectMenu.changed(() => {
    effect = effectMenu.value();
  });

  // button for a new random layout
  const shuffleButton = createButton('Shuffle');
  shuffleButton.position(windowWidth - 200, windowHeight - 54);
  shuffleButton.mouseClicked(() => {
    seed++;
  });

  // checkbox for accessibility
  const accessibleCheckbox = createCheckbox('Accessibility', false);
  accessibleCheckbox.position(windowWidth - 124, windowHeight - 52);
  accessibleCheckbox.changed(() => {
    accessible = accessibleCheckbox.checked();
  });

  readText(TEXT);
}

// turn the typed text into words made of letters
// gap = random space after a letter (0 or 1 unit), push = extra space from hovering (0 to 1 unit)
function readText(value) {
  words = value
    .split(' ')
    .filter((word) => word.length > 0) 
    .map((word) => [...word].map((char) => ({ char, gap: 0, push: 0 })));
}

function fontSize() {
  return constrain(map(width, 320, 1440, 48, 140), 48, 140);
}

function draw() {
  background('#e8e8e8');
  fill(0);
  randomSeed(seed);

  const size = fontSize();
  const unit = size * UNIT;
  const margin = size * 0.5;
  textSize(size);

  const randomSpacing = !accessible && (effect === RANDOM_SPACING || effect === RANDOM_LAYOUT);
  const randomLineHeight = !accessible && effect === RANDOM_LAYOUT;
  const hover = !accessible && effect === HOVER_SPACING;
  const hoverSpread = !accessible && effect === HOVER_SPREAD;

  // how much of the random spacing to show: all of it, none, or (when hovering the whole text) somewhere in between
  const spacing = randomSpacing ? 1 : hoverSpread ? spread : 0;

  // randomly give each letter 0 or 1 unit of space after it
  for (const word of words) {
    word.forEach((letter, i) => {
      letter.gap = i < word.length - 1 ? floor(random(2)) : 0;
    });
  }

  // where a line starts: the margin, plus a random 0–4 units for the random layout
  const lineStart = () => (randomLineHeight ? margin + floor(random(MAX_INDENT + 1)) * unit : margin);

  const widestSpacing = hoverSpread ? 1 : spacing;
  const widestWordGap = lerp(textWidth(' '), WORD_GAP * unit, widestSpacing);

  let x = lineStart();
  let plannedX = x;
  let restX = x;
  let y = margin + size;
  const newLine = () => {
    x = lineStart();
    plannedX = x;
    restX = x;
    y += size * LINE_HEIGHT * (randomLineHeight ? random(LINE_HEIGHTS) : 1);
  };
  const advance = (letter) =>
    textWidth(letter.char) + size * LETTER_SPACING + letter.gap * spacing * unit + letter.push * unit;
  let rightmost = 0; // how far right the widest text reaches, to know if the mouse is over it

  let closest = null;
  let closestDistance = size * 0.3; 

  for (const word of words) {
    // measure the word at its widest, and move it to the next line if it wouldn't fit
    let widestWordWidth = 0;

    for (const letter of word) {
      widestWordWidth += textWidth(letter.char) + size * LETTER_SPACING + letter.gap * widestSpacing * unit;
    }
    if (hover && word.length > 1) {
      widestWordWidth += unit;
    } // room for one gap pushed open by hovering

    if (plannedX + widestWordWidth > width - margin) {
      newLine();
    }
    plannedX += widestWordWidth;
    rightmost = max(rightmost, plannedX);
    plannedX += widestWordGap;

    word.forEach((letter, i) => {
      text(letter.char, x, y);
      x += advance(letter);
      
      const spaceStart = restX + textWidth(letter.char) + size * LETTER_SPACING;
      restX += advance(letter) - letter.push * unit;
      const gapX = (spaceStart + restX) / 2;
      const isLast = i === word.length - 1;
      const onThisLine = mouseY > y - size * 0.8 && mouseY < y + size * 0.2;
      if (hover && !isLast && onThisLine && abs(mouseX - gapX) < closestDistance) {
        closest = letter;
        closestDistance = abs(mouseX - gapX);
      }
    });

    // a normal space between words, growing to 3 units with the random spacing
    x += lerp(textWidth(' '), WORD_GAP * unit, spacing);
    restX += lerp(textWidth(' '), WORD_GAP * unit, spacing);
  }

  const overText = mouseX > margin && mouseX < rightmost && mouseY > margin + size * 0.2 && mouseY < y + size * 0.2;
  spread = lerp(spread, hoverSpread && overText ? 1 : 0, SPEED);

  // each frame they move a little towards that, so they open and close smoothly
  for (const word of words) {
    for (const letter of word) letter.push = lerp(letter.push, letter === closest ? 1 : 0, SPEED);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

Object.assign(window, { preload, setup, draw, windowResized });
new p5();
