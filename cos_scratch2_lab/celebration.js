/* Brief, silent fireworks above the result dialog; never intercept clicks. */
(() => {
  let stopPrevious = () => {};
  window.celebratePerfectScore = () => {
    stopPrevious();
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1000";
    document.body.append(canvas);
    const context = canvas.getContext("2d");
    if (!context) { canvas.remove(); return; }
    let frame, stopped = false;
    const cleanup = () => {
      if (stopped) return;
      stopped = true; cancelAnimationFrame(frame); canvas.remove();
    };
    stopPrevious = cleanup;
    const width = innerWidth, height = innerHeight, ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * ratio; canvas.height = height * ratio; context.scale(ratio, ratio);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const colors = ["#ffcf40", "#ff6b88", "#46d8bf", "#70b7ff", "#b29aff"];
    const particles = [];
    for (let burst = 0; burst < (reduced ? 1 : 5); burst++) {
      const x = width * (0.15 + Math.random() * 0.7), y = height * (0.15 + Math.random() * 0.35);
      for (let n = 0; n < 48; n++) {
        const angle = Math.PI * 2 * n / 48, speed = 70 + Math.random() * 140;
        particles.push({x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          delay: burst * 0.32, color: colors[n % colors.length]});
      }
    }
    const start = performance.now();
    function draw(now) {
      if (stopped) return;
      const elapsed = (now - start) / 1000;
      if (elapsed > (reduced ? 0.7 : 3.4)) { cleanup(); return; }
      context.clearRect(0, 0, width, height);
      for (const p of particles) {
        const t = reduced ? 0.3 : elapsed - p.delay;
        if (t < 0 || t > 1.8) continue;
        context.globalAlpha = reduced ? 0.8 : Math.max(0, 1 - t / 1.8);
        context.fillStyle = p.color;
        context.beginPath();
        context.arc(p.x + p.vx * t, p.y + p.vy * t + 65 * t * t, 3, 0, Math.PI * 2);
        context.fill();
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
  };
})();
