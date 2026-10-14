// TFI Auction - High performance lightweight Canvas Confetti (100% Offline)
(function () {
  let canvas = null;
  let ctx = null;
  let particles = [];
  let animId = null;

  function initCanvas() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'tfi-confetti-canvas';
      canvas.style.position = 'fixed';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '9999';
      document.body.appendChild(canvas);
      ctx = canvas.getContext('2d');
      resize();
      window.addEventListener('resize', resize);
    }
  }

  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth * window.devicePixelRatio;
    canvas.height = window.innerHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  const COLORS = ['#FFD700', '#FFA500', '#FF3B30', '#FF2D55', '#34C759', '#00C7BE', '#AF52DE', '#FF9500'];

  function spawn(count = 70, originX = 0.5, originY = 0.4) {
    initCanvas();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const startX = originX * w;
    const startY = originY * h;

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 9 + 4;
      particles.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        size: Math.random() * 8 + 5,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 12,
        wobble: Math.random() * 10,
        alpha: 1,
        decay: Math.random() * 0.015 + 0.01
      });
    }

    if (!animId) {
      loop();
    }
  }

  function loop() {
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.22; // gravity
      p.vx *= 0.98; // air resistance
      p.rotation += p.rotSpeed;
      p.alpha -= p.decay;

      if (p.alpha <= 0 || p.y > window.innerHeight + 50) {
        particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }

    if (particles.length > 0) {
      animId = requestAnimationFrame(loop);
    } else {
      cancelAnimationFrame(animId);
      animId = null;
      if (canvas && ctx) {
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    }
  }

  window.TFI_CONFETTI = {
    fire: (count = 80, x = 0.5, y = 0.4) => spawn(count, x, y),
    clear: () => {
      particles = [];
      if (ctx && canvas) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    }
  };
})();
