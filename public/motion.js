/* AutoPatch Framer-Style Motion & Smooth Scroll Engine
   Zero dependencies · Respects prefers-reduced-motion · 60fps GPU transforms */

(() => {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // 1. Top viewport scroll progress hairline
  function initScrollProgress() {
    let bar = document.querySelector('.scroll-progress-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'scroll-progress-bar';
      bar.setAttribute('aria-hidden', 'true');
      document.body.prepend(bar);
    }

    let ticking = false;
    const update = () => {
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop || 0;
      const maxScroll = Math.max(1, doc.scrollHeight - window.innerHeight);
      const progress = Math.min(1, Math.max(0, scrollTop / maxScroll));
      bar.style.transform = `scaleX(${progress})`;
      ticking = false;
    };

    window.addEventListener(
      'scroll',
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    update();
  }

  // 2. Framer-like viewport reveal observer with staggered springs
  function initReveals() {
    const targets = [...document.querySelectorAll('[data-reveal]')];
    if (targets.length === 0) return;

    if (prefersReduced || !('IntersectionObserver' in window)) {
      for (const el of targets) el.classList.add('is-visible');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const el = entry.target;
            const delay = el.dataset.revealDelay;
            if (delay) el.style.transitionDelay = `${delay}ms`;
            el.classList.add('is-visible');
            observer.unobserve(el);
          }
        }
      },
      {
        threshold: 0.08,
        rootMargin: '0px 0px -36px 0px',
      },
    );

    for (const el of targets) {
      observer.observe(el);
    }

    // Safety fallback: ensure elements never stay invisible on full-page captures or jump-scrolls
    window.setTimeout(() => {
      targets.forEach((el, idx) => {
        if (!el.classList.contains('is-visible')) {
          el.style.transitionDelay = `${Math.min(idx * 40, 240)}ms`;
          el.classList.add('is-visible');
        }
      });
    }, 300);
  }

  // 3. Smooth anchor scrolling with header offset
  function initSmoothAnchors() {
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link) return;
      const hash = link.getAttribute('href');
      if (!hash || hash === '#') return;
      const target = document.querySelector(hash);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({
        behavior: prefersReduced ? 'auto' : 'smooth',
        block: 'start',
      });
      if (history.replaceState) {
        history.replaceState(null, '', hash);
      }
    });
  }

  function boot() {
    initScrollProgress();
    initReveals();
    initSmoothAnchors();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
