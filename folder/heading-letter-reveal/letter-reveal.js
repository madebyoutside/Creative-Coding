import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(SplitText);

const defaults = { 
  stagger: 0.05, 
  delay: 0.3, 
  duration: 0.3, 
  order: 'text' 
};

export function play(heading) {
  const settings = { ...defaults, ...heading.dataset };

  // SplitText wraps every line, word and letter in its own element
  heading.textContent = heading.textContent; // undo the previous split when replaying
  const split = SplitText.create(heading, { 
    type: 'lines, words, chars', 
    charsClass: 'char',
    overwrite: false, // otherwise SplitText puts the old text back before splitting
  });

  const groups = {
    text: [split.chars],
    words: [split.words],
    lines: split.lines.map((line) => line.querySelectorAll('.char')),
  }[settings.order];

  groups.forEach((group) => {
    gsap.fromTo(group, { 
      clipPath: 'inset(-20% 100% -20% 0%)' 
    }, {
      clipPath: 'inset(-20% 0% -20% 0%)',
      duration: Math.max(0.001, settings.duration), 
      delay: Number(settings.delay),
      stagger: Number(settings.stagger),
      ease: 'none',
    });
  });

  heading.style.visibility = 'visible';
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) {
      return; 
    }
    play(entry.target);
    observer.unobserve(entry.target);
  });
});

// Wait for fonts, so lines are measured with the real font
document.fonts.ready.then(() => {
  document.querySelectorAll('.letter-reveal').forEach((heading) => {
    observer.observe(heading);
  });
});
