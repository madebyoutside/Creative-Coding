import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { play as playLetters } from './letter-reveal.js';
import { play as playWords } from './word-reveal.js';

new Lenis({
  autoRaf: true,
});

function connect(form, heading, play) {
  function update() {
    form.querySelectorAll('output').forEach((output) => {
      output.value = output.previousElementSibling.value;
    });

    heading.textContent = form.elements.text.value;

    // form.elements has no forEach of its own, so turn it into an array first
    Array.from(form.elements).forEach((input) => {
      if (input.name && input.name !== 'text') {
        heading.dataset[input.name] = input.value;
      }
    });
    play(heading);
  }

  form.addEventListener('input', update);
  form.addEventListener('reset', () => 
    setTimeout(update)
  );

  form.querySelector('.replay').addEventListener('click', () => 
    play(heading)
  );
}

connect(document.querySelector('.letter-controls'), document.querySelector('.letter-reveal'), playLetters);
connect(document.querySelector('.word-controls'), document.querySelector('.word-reveal'), playWords);
