import gsap from 'gsap';
import { splitText } from '../effects-on-text-no-canvas/text-effect.js';
import { start, watch } from './trigger.js';

const defaults = {
  delay: 0.3,
  duration: 0.6,
  shiftDelay: 1.5,
  shiftDuration: 0.8,
};

// Fades in with plain spacing (.is-tight hides the gaps), then opens the gaps from data-effect after a pause
export function play(heading) {
  const settings = { ...defaults, ...heading.dataset };

  // Only split when the text was replaced, so Replay keeps the current gaps
  if (!heading.querySelector('.char')) {
    splitText(heading);
  }

  // close any gaps left open by the last run straight away, without the shift transition
  heading.classList.add('is-tight', 'no-transition');
  void heading.offsetWidth;
  heading.classList.remove('no-transition');
  heading.style.setProperty('--shift-duration', `${settings.shiftDuration}s`);

  const timeline = gsap.timeline({ delay: Number(settings.delay) });

  // fade the inner .lines box, since the heading itself has a CSS opacity transition from text-effect.css
  timeline.fromTo(heading.querySelector('.lines'), { opacity: 0 }, {
    opacity: 1,
    duration: Math.max(0.001, settings.duration),
    ease: 'power1.out',
  });
  // counted from the end of the fade, so the shift waits until the heading is fully in
  timeline.call(() => heading.classList.remove('is-tight'), null, `+=${settings.shiftDelay}`);

  start(heading, timeline);
  heading.style.visibility = 'visible';
}

watch('.shift-reveal', play);
