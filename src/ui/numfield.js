// Changing a number field without typing: drag its name left or right, or
// use the − / + buttons. Shift makes steps 10× bigger, Alt 10× smaller.
import { h } from './dom.js';

const PX_PER_STEP = 6;

const scaled = (base, e) => base * (e?.shiftKey ? 10 : e?.altKey ? 0.1 : 1);

// label: element to drag; base: size of one step; onStep(delta).
export function nudgeControls(label, base, onStep) {
  label.classList.add('scrub');
  label.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    label.setPointerCapture?.(e.pointerId);
    let last = e.clientX;
    let acc = 0;
    const move = (ev) => {
      acc += ev.clientX - last;
      last = ev.clientX;
      const n = Math.trunc(acc / PX_PER_STEP);
      if (!n) return;
      acc -= n * PX_PER_STEP;
      onStep(n * scaled(base, ev));
    };
    const up = () => {
      label.removeEventListener('pointermove', move);
      label.removeEventListener('pointerup', up);
      label.removeEventListener('pointercancel', up);
    };
    label.addEventListener('pointermove', move);
    label.addEventListener('pointerup', up);
    label.addEventListener('pointercancel', up);
  });
  const button = (sign, title) => {
    const b = h('button.nf-btn', { type: 'button', str: sign > 0 ? '+' : '−', title });
    b.tabIndex = -1;
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onStep(sign * scaled(base, e));
    });
    return b;
  };
  return h('span.nf-btns', button(-1, 'Smaller (Shift: 10×). You can also drag the name.'), button(1, 'Bigger (Shift: 10×). You can also drag the name.'));
}
