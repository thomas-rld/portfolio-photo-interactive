(() => {
  "use strict";

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (current, target, t) => current + (target - current) * t;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

  class Viewfinder {
    constructor(root) {
      this.root = root;
      this.x = window.innerWidth * 0.5;
      this.y = window.innerHeight * 0.5;
      this.tx = this.x;
      this.ty = this.y;
      this.raf = 0;
      if (coarsePointer) return;
      window.addEventListener("mousemove", this.onMove, { passive: true });
    }

    onMove = (event) => {
      this.tx = event.clientX;
      this.ty = event.clientY;
      if (!this.root.classList.contains("is-on")) {
        this.x = this.tx;
        this.y = this.ty;
        this.root.classList.add("is-on");
      }
      if (!this.raf) this.raf = requestAnimationFrame(this.tick);
    };

    lock(state) {
      this.root.classList.toggle("is-locked", state);
    }

    tick = () => {
      this.x = lerp(this.x, this.tx, reducedMotion ? 1 : 0.22);
      this.y = lerp(this.y, this.ty, reducedMotion ? 1 : 0.22);
      this.root.style.transform = `translate(${this.x}px, ${this.y}px)`;
      if (Math.abs(this.tx - this.x) > 0.4 || Math.abs(this.ty - this.y) > 0.4) {
        this.raf = requestAnimationFrame(this.tick);
        return;
      }
      this.raf = 0;
    };
  }

  class Terminal {
    constructor(prompt, title, meta, hint, clock) {
      this.queue = [
        { el: prompt, text: "root@a7v:~# expose --init" },
        { el: title, text: "THOMAS ROLLAND - PORTFOLIO" },
        { el: meta, text: "[SYS_INIT] SONY A7V | 10mm, 16-35mm & 70-200mm" },
      ].filter((item) => item.el);
      this.hint = hint;
      this.clock = clock;
      this.line = 0;
      this.index = 0;
      this.last = 0;
      this.step = 28;
      this.alive = false;
      this.raf = 0;
      this.clockTimer = 0;
      this.caret = document.createElement("span");
      this.caret.className = "terminal__caret";
      this.caret.id = "caret";
      this.caret.setAttribute("aria-hidden", "true");
    }

    start() {
      this.tickClock();
      this.clockTimer = window.setInterval(this.tickClock, 1000);
      this.hint?.classList.add("is-ready");
      if (reducedMotion) {
        this.dumpAll();
        this.finish();
        return;
      }
      this.alive = true;
      this.attachCaret();
      this.raf = requestAnimationFrame(this.tick);
    }

    dumpAll() {
      this.queue.forEach((item) => {
        item.el.textContent = item.text;
      });
    }

    attachCaret() {
      const current = this.queue[this.line];
      if (current) current.el.appendChild(this.caret);
    }

    tickClock = () => {
      if (!this.clock) return;
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      this.clock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    };

    tick = (time) => {
      if (!this.alive) return;
      if (!this.last) this.last = time;
      if (time - this.last < this.step) {
        this.raf = requestAnimationFrame(this.tick);
        return;
      }
      this.last = time;

      const current = this.queue[this.line];
      if (!current) {
        this.finish();
        return;
      }

      current.el.textContent += current.text.charAt(this.index);
      current.el.appendChild(this.caret);
      this.index += 1;

      if (this.index >= current.text.length) {
        this.line += 1;
        this.index = 0;
        this.last = time + 180;
        this.attachCaret();
      }

      if (this.line >= this.queue.length) {
        this.finish();
        return;
      }

      this.raf = requestAnimationFrame(this.tick);
    };

    finish() {
      this.alive = false;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.dumpAll();
      this.caret.remove();
    }
  }

  class Panorama {
    constructor(section, pin, track, label) {
      this.section = section;
      this.pin = pin;
      this.track = track;
      this.label = label;
      this.enabled = Boolean(section && pin && track);
      this.slides = this.enabled ? [...track.querySelectorAll(".travel__slide")] : [];
      this.travel = 0;
    }

    measure() {
      if (!this.enabled) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      this.travel = Math.max(this.track.scrollWidth - vw, vw);
      this.section.style.height = `${vh + this.travel * 1.15}px`;
    }

    update() {
      if (!this.enabled) return;
      const rect = this.section.getBoundingClientRect();
      const distance = this.section.offsetHeight - window.innerHeight;
      const local = clamp(-rect.top, 0, distance);
      const progress = distance ? local / distance : 0;
      this.track.style.transform = `translate(${-progress * this.travel}px, 0)`;
      const index = Math.min(this.slides.length - 1, Math.floor(progress * this.slides.length));
      const place = this.slides[index]?.dataset.place;
      if (place && this.label && this.label.textContent !== place) this.label.textContent = place;
    }
  }

  class FitTitle {
    constructor(root) {
      this.root = root;
      this.lines = root ? [...root.querySelectorAll(".hero-title__line")] : [];
    }

    fit() {
      if (!this.root) return;
      this.root.style.fontSize = "";
      const available = this.root.clientWidth;
      if (!available) return;
      let widest = 0;
      this.lines.forEach((line) => {
        widest = Math.max(widest, line.scrollWidth);
      });
      if (!widest || widest <= available) return;
      const computed = parseFloat(getComputedStyle(this.root).fontSize);
      this.root.style.fontSize = `${((computed * available) / widest) * 0.98}px`;
    }
  }

  class App {
    constructor() {
      this.chrome = document.getElementById("chrome");
      this.counter = document.getElementById("counter");
      this.frameValue = document.getElementById("frame-value");
      this.scrollRaf = 0;
      this.resizeRaf = 0;
      this.frameLabel = "000";

      this.viewfinder = new Viewfinder(document.getElementById("viewfinder"));
      this.terminal = new Terminal(
        document.getElementById("typed-prompt"),
        document.getElementById("typed-title"),
        document.getElementById("typed-meta"),
        document.getElementById("hint"),
        document.getElementById("hero-clock")
      );
      this.panorama = new Panorama(
        document.getElementById("voyage"),
        document.getElementById("travel-pin"),
        document.getElementById("travel-track"),
        document.getElementById("travel-place")
      );
      this.fitTitle = new FitTitle(document.querySelector(".hero-title"));

      this.bind();
      this.observeShots();
      this.terminal.start();
      this.scheduleResize();
      if (document.fonts?.ready) document.fonts.ready.then(() => this.scheduleResize());
    }

    bind() {
      window.addEventListener("scroll", this.onScroll, { passive: true });
      window.addEventListener("resize", this.scheduleResize, { passive: true });
      document.querySelectorAll("[data-cursor='lock']").forEach((node) => {
        node.addEventListener("mouseenter", () => this.viewfinder.lock(true));
        node.addEventListener("mouseleave", () => this.viewfinder.lock(false));
      });
    }

    onScroll = () => {
      if (this.scrollRaf) return;
      this.scrollRaf = requestAnimationFrame(this.paintScroll);
    };

    paintScroll = () => {
      this.scrollRaf = 0;
      this.panorama.update();
      const pastHero = window.scrollY > window.innerHeight * 0.28;
      this.chrome?.classList.toggle("is-live", pastHero);
      this.counter?.classList.toggle("is-live", pastHero);
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const frame = String(Math.round((window.scrollY / max) * 36)).padStart(3, "0");
      if (frame !== this.frameLabel) {
        this.frameLabel = frame;
        this.frameValue.textContent = frame;
      }
    };

    observeShots() {
      const shots = document.querySelectorAll(".artists__grid .shot");
      if (reducedMotion) {
        shots.forEach((shot) => shot.classList.add("is-in"));
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-in");
            observer.unobserve(entry.target);
          });
        },
        { threshold: 0.16, rootMargin: "0px 0px -10% 0px" }
      );
      shots.forEach((shot) => observer.observe(shot));
    }

    scheduleResize = () => {
      if (this.resizeRaf) return;
      this.resizeRaf = requestAnimationFrame(() => {
        this.resizeRaf = 0;
        this.panorama.measure();
        this.fitTitle.fit();
        this.paintScroll();
      });
    };
  }

  class ClubStrip {
    constructor(section) {
      this.strip = section?.querySelector(".club__strip");
      if (!this.strip) return;
      this.shots = [...this.strip.querySelectorAll(".shot")];
      this.prev = section.querySelector("[data-club-dir='-1']");
      this.next = section.querySelector("[data-club-dir='1']");
      this.raf = 0;
      this.prev?.addEventListener("click", () => this.step(-1));
      this.next?.addEventListener("click", () => this.step(1));
      this.strip.addEventListener("scroll", this.onScroll, { passive: true });
      window.addEventListener("resize", this.onScroll, { passive: true });
      this.sync();
    }

    step(direction) {
      const active = this.strip.querySelector(".shot.is-active") || this.shots[0];
      const styles = getComputedStyle(this.strip);
      const gap = parseFloat(styles.columnGap || styles.gap) || 32;
      this.strip.scrollBy({
        left: (active.getBoundingClientRect().width + gap) * direction,
        behavior: "smooth",
      });
    }

    onScroll = () => {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.sync();
      });
    };

    sync() {
      const bounds = this.strip.getBoundingClientRect();
      const mid = bounds.left + bounds.width / 2;
      let closest = this.shots[0];
      let best = Infinity;
      this.shots.forEach((shot) => {
        const rect = shot.getBoundingClientRect();
        const dist = Math.abs(rect.left + rect.width / 2 - mid);
        if (dist < best) {
          best = dist;
          closest = shot;
        }
      });
      this.shots.forEach((shot) => shot.classList.toggle("is-active", shot === closest));
      const index = this.shots.indexOf(closest);
      if (this.prev) this.prev.disabled = index <= 0;
      if (this.next) this.next.disabled = index >= this.shots.length - 1;
    }
  }

  const boot = () => {
    new App();
    new ClubStrip(document.getElementById("nuit"));
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
