import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function start(heading, timeline) {
  heading.reveal?.scrollTrigger?.kill(); // clean up the previous run when replaying
  heading.reveal?.kill();
  heading.reveal = timeline;

  if (heading.dataset.trigger === 'scroll') {
    timeline.delay(0); // the start delay means nothing when scroll drives it
    timeline.pause();
    ScrollTrigger.create({
      trigger: heading,
      start: 'top 85%', // fully hidden when the heading's top is near the bottom of the screen
      end: 'bottom 40%', // fully shown once its bottom passes just above the middle
      scrub: true,
      animation: timeline,
    });
  }
}

// Set up every heading matching the selector, once fonts are loaded so lines are measured with the real font
export function watch(selector, play) {
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
    document.querySelectorAll(selector).forEach((heading) => {
      // scroll mode needs its ScrollTrigger right away; viewport mode waits until the heading is seen
      if (heading.dataset.trigger === 'scroll') {
        play(heading);
      } else {
        observer.observe(heading);
      }
    });
  });
}
