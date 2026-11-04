import Lenis from 'lenis';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import 'lenis/dist/lenis.css';
import { shuffle, breakLines } from '../effects-on-text-no-canvas/text-effect.js';
import { play as playLetters } from './letter-reveal.js';
import { play as playWords } from './word-reveal.js';

const lenis = new Lenis({
  autoRaf: true,
});
lenis.on('scroll', ScrollTrigger.update); // keep scroll-based reveals in step with Lenis' smooth scrolling

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

  // new random gaps (and indents / line heights) without replaying the reveal
  form.querySelector('.shuffle').addEventListener('click', () => 
    shuffle(heading)
  );

  // re-break the lines for the new width, keeping the room the spacing effect needs
  window.addEventListener('resize', () => 
    breakLines(heading)
  );
}

connect(document.querySelector('.letter-controls'), document.querySelector('.letter-reveal'), playLetters);
connect(document.querySelector('.word-controls'), document.querySelector('.word-reveal'), playWords);
