import p5 from 'p5';

// Each | adds 1 unit of space between those two letters (same spots as the mockup)
const TEXT = 'Ho|w to ma|xi|mize exp|ress|io|n';

const LINE_HEIGHT = 1; 
const LETTER_SPACING = -0.025; 
const UNIT = 0.2; 
const WORD_GAP = 3; //3 units of space between words

let words = [];

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont('Helvetica');
  textStyle(BOLD);
  noStroke();
  noLoop();

  const box = createInput(TEXT);
  box.position(20, windowHeight - 56);
  box.size(windowWidth - 48, 24);
  box.input(() => {
    readText(box.value());
    redraw();
  });

  readText(TEXT);
}

// Turn the typed text into words made of letters, each with its gap (0 or 1 unit)
function readText(value) {
  words = value
    .split(' ')
    .map((word) =>
      word.split('|').flatMap((part) => [...part].map((char, i) => ({ char, gap: i === part.length - 1 ? 1 : 0 }))),
    )
    .filter((word) => word.length > 0); // skip empty words, e.g. from double spaces
  // The last letter of a word has no gap after it
  for (const word of words) word[word.length - 1].gap = 0;
}

function fontSize() {
  return constrain(map(width, 320, 1440, 48, 140), 48, 140);
}

function draw() {
  background('#e8e8e8');
  fill(0);

  const size = fontSize();
  const unit = size * UNIT;
  const margin = size * 0.5;
  textSize(size);

  let x = margin;
  let y = margin + size;
  const newLine = () => {
    x = margin;
    y += size * LINE_HEIGHT;
  };
  const advance = (letter) => textWidth(letter.char) + size * LETTER_SPACING + letter.gap * unit; //how much does the letter takes a space

  for (const word of words) {
    // meeasure the word, and move it to the next line if it doesn't fit
    let wordWidth = 0;

    for (const letter of word) {
      wordWidth += advance(letter)
    };

    if (x + wordWidth > width - margin){ 
      newLine();
    } 

    for (const letter of word) {
      text(letter.char, x, y);
      x += advance(letter);
    }

    // 3 units between words
    x += WORD_GAP * unit;
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

Object.assign(window, { setup, draw, windowResized });
new p5();
