import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);

const defaults = {
  wordDelay: 0.15, 
  stagger: 0.04, 
  delay: 0.3, 
  duration: 0.3, 
  letters: 'wipe', 
  effect: 'clip',
};

const effects = {
  clip: [{ clipPath: 'inset(-20% 100% -20% 0%)' }, { clipPath: 'inset(-20% 0% -20% 0%)' }],
  fade: [{ opacity: 0 }, { opacity: 1 }],
};

export function play(heading) {
  const settings = { ...defaults, ...heading.dataset };

  heading.textContent = heading.textContent; // undo the previous split when replaying
  const split = SplitText.create(heading, {
    type: 'words, chars',
    charsClass: 'char',
    overwrite: false, // otherwise SplitText puts the old text back before splitting
  });

  const [from, to] = effects[settings.effect];

  // Shuffle the words, then start each one a little after the previous
  gsap.utils.shuffle([...split.words]).forEach((word, i) => {
    const byLetter = settings.letters === 'wipe';

    gsap.fromTo(byLetter ? word.querySelectorAll('.char') : word, from, {
      ...to,
      duration: Math.max(0.001, settings.duration),
      delay: Number(settings.delay) + i * settings.wordDelay,
      stagger: byLetter ? Number(settings.stagger) : 0,
      ease: 'none',
    });
  });

  heading.style.visibility = 'visible';
}

// Play each .word-reveal once, the first time it scrolls into view
const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) {
      return;
    }
    play(entry.target);
    observer.unobserve(entry.target);
  });
});

document.fonts.ready.then(() => {
  document.querySelectorAll('.word-reveal').forEach((heading) => {
    observer.observe(heading);
  });
});
