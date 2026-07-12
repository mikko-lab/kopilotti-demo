/**
 * Reusable SVG circular gauge. SVG circle + stroke-dasharray/stroke-dashoffset
 * rather than conic-gradient: rounded stroke caps read as "dashboard" not
 * "pie chart", and dashoffset transitions don't need @property registration
 * the way animating a conic-gradient's color stop smoothly would.
 *
 * The percentage is real DOM text (not baked into the SVG/canvas) — that's
 * what makes it accessible without extra ARIA plumbing; the decorative
 * <svg> itself is aria-hidden.
 *
 * Motion is gated behind prefers-reduced-motion at BOTH layers: a CSS
 * transition on the stroke (disabled globally in styles.css's reduced-motion
 * block) and a JS check here that skips the requestAnimationFrame count-up
 * and jumps straight to the final number. Handling only one layer leaves a
 * mismatched instant-stroke/animated-number (or vice versa) pair.
 */

const RADIUS = 40;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// The raw stroke colors (--success, --warning) fail normal-text AA contrast
// at this label's small font size (see styles.css's contrast comment block)
// — map each to its pre-computed text-safe companion token instead of
// reusing the stroke color directly for the qualitative-label text.
const QUAL_TEXT_COLOR = { '--success': '--success-text', '--primary': '--primary', '--warning': '--warning-text', '--error': '--error-text' };

function qualitativeLabel(value) {
  if (value >= 70) return 'Korkea';
  if (value >= 40) return 'Keskitasoa';
  return 'Matala';
}

export function createGauge(container, { label, value = 0, colorVar = '--primary' }) {
  const qualColorVar = QUAL_TEXT_COLOR[colorVar] || colorVar;
  container.innerHTML = `
    <div class="gauge">
      <svg viewBox="0 0 100 100" class="gauge-svg" aria-hidden="true">
        <circle class="gauge-track" cx="50" cy="50" r="${RADIUS}"></circle>
        <circle class="gauge-progress" cx="50" cy="50" r="${RADIUS}"
          style="stroke: var(${colorVar}); stroke-dasharray: ${CIRCUMFERENCE}; stroke-dashoffset: ${CIRCUMFERENCE};"></circle>
      </svg>
      <div class="gauge-text"><span class="gauge-value">0%</span></div>
    </div>
    <div class="gauge-label">${label}</div>
    <div class="gauge-qual" style="color: var(${qualColorVar})"></div>
  `;

  const wrapper = container.querySelector('.gauge');
  const progressCircle = container.querySelector('.gauge-progress');
  const valueText = container.querySelector('.gauge-value');
  const qualText = container.querySelector('.gauge-qual');
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', `${label}: 0 %`);

  function update(newValue) {
    const clamped = Math.max(0, Math.min(100, Math.round(newValue)));
    const offset = CIRCUMFERENCE * (1 - clamped / 100);
    progressCircle.style.strokeDashoffset = String(offset);
    wrapper.setAttribute('aria-label', `${label}: ${clamped} %`);
    qualText.textContent = qualitativeLabel(clamped);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      valueText.textContent = `${clamped}%`;
      return;
    }

    const start = parseInt(valueText.textContent, 10) || 0;
    const duration = 400;
    const startTime = performance.now();
    function step(now) {
      const t = Math.min((now - startTime) / duration, 1);
      const current = Math.round(start + (clamped - start) * t);
      valueText.textContent = `${current}%`;
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  update(value);
  return { update };
}
