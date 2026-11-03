import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

const scene = document.querySelector('.scene');
const controls = document.querySelector('.controls');

const lenis = new Lenis({ 
  autoRaf: true 
});

function update() {
  const rect = scene.getBoundingClientRect();
  // 0 when the scene's top enters the bottom of the viewport,
  // 1 when its bottom leaves the top, so the layers move with normal scrolling.
  const progress = Math.min(1, Math.max(0, (innerHeight - rect.top) / (innerHeight + rect.height)));
  scene.style.setProperty('--p', progress * 2 - 1);
}


lenis.on('scroll', update);
addEventListener('resize', update);
update();

function apply(input) {
  if (!input.name) return; // fieldsets and the reset button
  if (input.name === 'lerp') {
    lenis.options.lerp = Number(input.value);
  } else {
    document.querySelector(input.dataset.target).style.setProperty(input.name, input.value);
  }

  if (input.nextElementSibling?.tagName === 'OUTPUT') {
    input.nextElementSibling.value = input.value;
  }
}

function applyAll() {
  for (const input of controls.elements) {
    apply(input);
  }
}

controls.addEventListener('input', (e) => 
  apply(e.target)
);

controls.addEventListener('reset', () => 
  setTimeout(applyAll)
);
applyAll();
