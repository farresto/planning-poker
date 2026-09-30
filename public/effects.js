const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function confetti(durationMs = 3200) {
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const resize = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const colors = ['#c6e04a', '#4e54c8', '#ff6b57', '#ffd23f', '#35b6a0', '#ffffff'];
  const count = reduceMotion() ? 40 : 170;
  const parts = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 16,
    vy: -Math.random() * 15 - 5,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 10,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.35,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  function frame(t) {
    const elapsed = t - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, elapsed - durationMs * 0.7) / (durationMs * 0.3));
    for (const p of parts) {
      p.vy += 0.38;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
      ctx.restore();
    }
    if (elapsed < durationMs) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

export function floatEmoji(emoji, label) {
  const el = document.createElement('div');
  el.className = 'fx-reaction';
  el.style.left = `${8 + Math.random() * 84}vw`;
  el.style.top = `${14 + Math.random() * 70}vh`;
  el.innerHTML = `<span class="fx-reaction-emoji"></span><span class="fx-reaction-name"></span>`;
  el.firstChild.textContent = emoji;
  el.lastChild.textContent = label;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Throw `emoji` from element `fromEl` (or a screen edge) to element `toEl`. */
export function throwEmoji(emoji, fromEl, toEl) {
  if (!toEl) return;
  const to = centerOf(toEl);
  const from = fromEl ? centerOf(fromEl) : { x: Math.random() < 0.5 ? -40 : innerWidth + 40, y: innerHeight * 0.8 };
  const el = document.createElement('div');
  el.className = 'fx-throw';
  el.textContent = emoji;
  document.body.appendChild(el);
  const hit = () => {
    toEl.classList.remove('is-hit');
    void toEl.offsetWidth;
    toEl.classList.add('is-hit');
    setTimeout(() => toEl.classList.remove('is-hit'), 500);
  };
  if (reduceMotion()) {
    el.style.transform = `translate(${to.x}px, ${to.y}px) translate(-50%, -50%)`;
    hit();
    setTimeout(() => el.remove(), 700);
    return;
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const arc = Math.min(220, 80 + Math.hypot(dx, dy) * 0.35);
  const steps = 16;
  const frames = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from.x + dx * t;
    const y = from.y + dy * t - arc * 4 * t * (1 - t);
    frames.push({ transform: `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${t * 540}deg) scale(${1 + 0.4 * Math.sin(t * Math.PI)})` });
  }
  const anim = el.animate(frames, { duration: 750, easing: 'cubic-bezier(.3,.1,.6,1)', fill: 'forwards' });
  anim.onfinish = () => {
    hit();
    el.animate(
      [
        { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(1.5)`, opacity: 1 },
        { transform: `translate(${to.x + 18}px, ${to.y + 50}px) translate(-50%, -50%) rotate(40deg) scale(1)`, opacity: 0 },
      ],
      { duration: 650, easing: 'ease-in', fill: 'forwards' },
    ).onfinish = () => el.remove();
  };
}
