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
    constructor(typed, hint, clock) {
      this.typed = typed;
      this.hint = hint;
      this.clock = clock;
      this.buffer = "[SYS_INIT] THOMAS ROLLAND | SONY A7V | 10mm, 16-35mm & 70-200mm";
      this.index = 0;
      this.onDone = null;
    }

    start() {
      this.tickClock();
      window.setInterval(this.tickClock, 1000);
      if (reducedMotion) {
        this.typed.textContent = this.buffer;
        this.finish();
        return;
      }
      this.type();
    }

    tickClock = () => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      this.clock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    };

    type = () => {
      if (this.index >= this.buffer.length) {
        this.finish();
        return;
      }
      this.typed.textContent += this.buffer.charAt(this.index);
      this.index += 1;
      window.setTimeout(this.type, 22);
    };

    finish() {
      this.typed.textContent = this.buffer;
      this.hint.classList.add("is-ready");
      if (this.onDone) this.onDone();
    }
  }

  class Panorama {
    constructor(section, pin, track, label) {
      this.section = section;
      this.pin = pin;
      this.track = track;
      this.label = label;
      this.slides = [...track.querySelectorAll(".travel__slide")];
      this.travel = 0;
    }

    measure() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      this.travel = Math.max(this.track.scrollWidth - vw, vw);
      this.section.style.height = `${vh + this.travel * 1.15}px`;
    }

    update() {
      const rect = this.section.getBoundingClientRect();
      const distance = this.section.offsetHeight - window.innerHeight;
      const local = clamp(-rect.top, 0, distance);
      const progress = distance ? local / distance : 0;
      this.track.style.transform = `translate(${-progress * this.travel}px, 0)`;
      const index = Math.min(this.slides.length - 1, Math.floor(progress * this.slides.length));
      const place = this.slides[index]?.dataset.place;
      if (place && this.label.textContent !== place) this.label.textContent = place;
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
      this.loader = document.getElementById("loader");
      this.chrome = document.getElementById("chrome");
      this.counter = document.getElementById("counter");
      this.frameValue = document.getElementById("frame-value");
      this.ready = false;
      this.exposed = false;
      this.scrollRaf = 0;
      this.resizeRaf = 0;
      this.frameLabel = "000";

      this.viewfinder = new Viewfinder(document.getElementById("viewfinder"));
      this.terminal = new Terminal(
        document.getElementById("typed"),
        document.getElementById("hint"),
        document.getElementById("loader-clock")
      );
      this.panorama = new Panorama(
        document.getElementById("voyage"),
        document.getElementById("travel-pin"),
        document.getElementById("travel-track"),
        document.getElementById("travel-place")
      );
      this.fitTitle = new FitTitle(document.querySelector(".hero-title"));

      this.terminal.onDone = () => {
        this.ready = true;
      };

      this.bind();
      this.observeShots();
      this.terminal.start();
      this.scheduleResize();
      if (document.fonts?.ready) document.fonts.ready.then(() => this.scheduleResize());
    }

    bind() {
      document.documentElement.classList.add("is-locked");
      window.addEventListener("wheel", this.onFirstScroll, { passive: false });
      window.addEventListener("touchmove", this.onFirstScroll, { passive: false });
      window.addEventListener("keydown", this.onKey);
      this.loader.addEventListener("click", () => this.expose());
      window.addEventListener("scroll", this.onScroll, { passive: true });
      window.addEventListener("resize", this.scheduleResize, { passive: true });

      document.querySelectorAll("[data-cursor='lock']").forEach((node) => {
        node.addEventListener("mouseenter", () => this.viewfinder.lock(true));
        node.addEventListener("mouseleave", () => this.viewfinder.lock(false));
      });
    }

    onFirstScroll = (event) => {
      if (!this.ready) {
        event.preventDefault();
        return;
      }
      if (!this.exposed) {
        const delta = event.deltaY || 0;
        this.expose();
        if (delta) window.scrollBy({ top: delta, behavior: "smooth" });
      }
    };

    onKey = (event) => {
      const keys = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Spacebar"];
      if (!keys.includes(event.key)) return;
      if (!this.ready) {
        event.preventDefault();
        return;
      }
      if (!this.exposed) this.expose();
    };

    expose() {
      if (this.exposed || !this.ready) return;
      this.exposed = true;
      this.loader.classList.add("is-exposing");
      this.chrome.classList.add("is-live");
      this.counter.classList.add("is-live");
      document.documentElement.classList.remove("is-locked");
      window.removeEventListener("wheel", this.onFirstScroll);
      window.removeEventListener("touchmove", this.onFirstScroll);
      window.setTimeout(() => {
        this.loader.classList.add("is-gone");
      }, reducedMotion ? 0 : 320);
      this.scheduleResize();
    }

    onScroll = () => {
      if (this.scrollRaf) return;
      this.scrollRaf = requestAnimationFrame(this.paintScroll);
    };

    paintScroll = () => {
      this.scrollRaf = 0;
      if (!this.exposed) return;
      this.panorama.update();
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
        if (this.exposed) this.paintScroll();
      });
    };
  }

  const boot = () => new App();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
