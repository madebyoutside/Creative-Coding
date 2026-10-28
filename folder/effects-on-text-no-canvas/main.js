import { splitText, shuffle, breakLines, setEffect } from './text-effect.js';

const headline = document.querySelector('.headline');
const textInput = document.querySelector('.text-input');
const effectSelect = document.querySelector('.effect-select');
const shuffleButton = document.querySelector('.shuffle');
const accessibilityToggle = document.querySelector('.accessible');

function currentEffect() {
  return accessibilityToggle.checked ? 'none' : effectSelect.value;
}

function changeEffect() {
  setEffect(headline, currentEffect());
}

// set the effect first, so the spacing is there from the start instead of animating in
headline.dataset.effect = currentEffect();
splitText(headline);

document.querySelector('.controls').addEventListener('submit', (event) => {
  event.preventDefault();
});

textInput.addEventListener('input', () => {
  headline.textContent = textInput.value;
  splitText(headline);
});

effectSelect.addEventListener('change', changeEffect);
accessibilityToggle.addEventListener('change', changeEffect);
shuffleButton.addEventListener('click', () => shuffle(headline));
window.addEventListener('resize', () => breakLines(headline));
document.fonts.ready.then(() => breakLines(headline));
