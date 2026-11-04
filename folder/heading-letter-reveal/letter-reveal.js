import gsap from 'gsap';
import { splitText } from '../effects-on-text-no-canvas/text-effect.js';
import { start, watch } from './trigger.js';

const defaults = { 
  stagger: 0.05, 
  delay: 0.3, 
  duration: 0.3, 
  tilt: 2, 
  order: 'text' 
};

// split into lines of letters, using the .new-line marks breakLines() puts on each line's first word
function lines(heading) {
  const result = [];
  heading.querySelectorAll('.word').forEach((word) => {
    if (word.classList.contains('new-line')) {
      result.push([]);
    }
    result.at(-1).push(...word.querySelectorAll('.char'));
  });
  return result;
}

export function play(heading) {
  const settings = { ...defaults, ...heading.dataset };

  // text-effect.js wraps every word and letter in its own span, with the spacing effect from data-effect.
  // Only split when the text was replaced, so Replay keeps the current spacing
  if (!heading.querySelector('.char')) {
    splitText(heading);
  }

  const groups = {
    text: [heading.querySelectorAll('.char')],
    words: [heading.querySelectorAll('.word')],
    lines: lines(heading),
  }[settings.order];

  const timeline = gsap.timeline({ delay: Number(settings.delay) });

  groups.forEach((group) => {
    timeline.fromTo(group, { 
      clipPath: 'inset(-20% 100% -20% 0%)',
      rotate: Number(settings.tilt),
      transformOrigin: '0% 100%', // pivot on the bottom-left corner, so the letter tips up from the baseline
    }, {
      clipPath: 'inset(-20% 0% -20% 0%)',
      rotate: 0,
      duration: Math.max(0.001, settings.duration), 
      stagger: Number(settings.stagger),
      ease: 'none',
    }, 0); // every group starts at the beginning of the timeline
  });

  start(heading, timeline);
  heading.style.visibility = 'visible';
}

watch('.letter-reveal', play);
