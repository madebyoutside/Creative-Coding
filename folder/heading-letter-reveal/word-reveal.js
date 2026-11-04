import gsap from 'gsap';
import { splitText } from '../effects-on-text-no-canvas/text-effect.js';
import { start, watch } from './trigger.js';

const defaults = {
  wordDelay: 0.15, 
  stagger: 0.04, 
  delay: 0.3, 
  duration: 0.3, 
  tilt: 2, 
  letters: 'wipe', 
  animation: 'clip',
};

const animations = {
  clip: (tilt) => [
    { clipPath: 'inset(-20% 100% -20% 0%)', rotate: tilt, transformOrigin: '0% 100%' },
    { clipPath: 'inset(-20% 0% -20% 0%)', rotate: 0 },
  ],
  fade: () => [{ opacity: 0 }, { opacity: 1 }],
};

export function play(heading) {
  const settings = { ...defaults, ...heading.dataset };

  // text-effect.js wraps every word and letter in its own span, with the spacing effect from data-effect.
  // Only split when the text was replaced, so Replay keeps the current spacing
  if (!heading.querySelector('.char')) {
    splitText(heading);
  }

  const [from, to] = animations[settings.animation](Number(settings.tilt));

  const timeline = gsap.timeline({ delay: Number(settings.delay) });

  // Shuffle the words, then start each one a little after the previous
  gsap.utils.shuffle([...heading.querySelectorAll('.word')]).forEach((word, i) => {
    const byLetter = settings.letters === 'wipe';

    timeline.fromTo(byLetter ? word.querySelectorAll('.char') : word, from, {
      ...to,
      duration: Math.max(0.001, settings.duration),
      stagger: byLetter ? Number(settings.stagger) : 0,
      ease: 'none',
    }, i * settings.wordDelay);
  });

  start(heading, timeline);
  heading.style.visibility = 'visible';
}

watch('.word-reveal', play);
