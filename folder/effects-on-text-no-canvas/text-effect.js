// wrap every word and letter in a span
export function splitText(el) {
  const text = el.textContent.trim();
  el.setAttribute('aria-label', text);
  el.textContent = '';

  // inner box as wide as the text, so hover only reacts over the words
  const linesEl = document.createElement('span');
  linesEl.className = 'lines';
  el.append(linesEl);

  for (const word of text.split(/\s+/)) {
    const wordEl = document.createElement('span');
    wordEl.className = 'word';
    wordEl.setAttribute('aria-hidden', 'true');

    for (const letter of word) {
      const charEl = document.createElement('span');
      charEl.className = 'char';
      charEl.textContent = letter;
      wordEl.append(charEl);
    }

    linesEl.append(wordEl);
  }

  shuffle(el);
}

// random letters get a gap after them
export function shuffle(el) {
  for (const charEl of el.querySelectorAll('.char:not(:last-child)')) {
    charEl.classList.toggle('gap', Math.random() < 0.5);
  }
  breakLines(el);
}

// fix the line breaks to where they'd be with all gaps open, so words don't jump to the next line on hover
export function breakLines(el) {
  el.querySelectorAll('br').forEach((br) => br.remove());

  const clone = el.cloneNode(true);
  clone.classList.add('text-measure');
  clone.querySelectorAll('.new-line').forEach((wordEl) => wordEl.classList.remove('new-line'));
  // keep room for the biggest indent (4 units) or one hovered gap (1 unit)
  const room = { 'random-layout': '0.8em', 'hover-gap': '0.2em' }[el.dataset.effect] ?? '0px';
  clone.style.width = `calc(${el.getBoundingClientRect().width}px - ${room})`;
  el.after(clone);
  const wordTops = [...clone.querySelectorAll('.word')].map((wordEl) => wordEl.offsetTop);
  clone.remove();

  el.querySelectorAll('.word').forEach((wordEl, i) => {
    const isNewLine = i === 0 || wordTops[i] !== wordTops[i - 1];
    wordEl.classList.toggle('new-line', isNewLine);
    if (!isNewLine) return;

    wordEl.style.setProperty('--indent', Math.floor(Math.random() * 5));
    wordEl.style.setProperty('--line-height', [1, 1.2, 1.3][Math.floor(Math.random() * 3)]);
    if (i > 0) wordEl.before(document.createElement('br'));
  });
}

// fade out, swap the effect while the spacing transitions are off, fade back in,
// so words don't slide around while the lines are being re-broken
export function setEffect(el, effect) {
  clearTimeout(el.switchTimer);
  el.classList.add('is-switching');

  el.switchTimer = setTimeout(() => {
    el.dataset.effect = effect;
    breakLines(el);
    void el.offsetWidth; // apply the new spacing now, before transitions come back on
    el.classList.remove('is-switching');
  }, 200);
}
