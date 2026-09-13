(() => {
  "use strict";

  /**
   * Interpolation linéaire.
   * current + (target - current) * t
   * t proche de 0 = inertie lourde (cinéma) ; t = 1 = accroche immédiate.
   */
  const lerp = (current, target, t) => current + (target - current) * t;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  /** Remap une valeur d'un intervalle vers un autre. */
  const mapRange = (value, inMin, inMax, outMin, outMax) => {
    const progress = (value - inMin) / (inMax - inMin || 1);
    return outMin + clamp(progress, 0, 1) * (outMax - outMin);
  };

  /** Position Y d'un nœud dans l'espace du contenu, indépendante du LERP. */
  const offsetY = (node, content) => {
    const nodeRect = node.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return nodeRect.top - contentRect.top;
  };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

  class Viewfinder {
    constructor(root) {
      this.root = root;
      this.x = window.innerWidth * 0.5;
      this.y = window.innerHeight * 0.5;
      this.tx = this.x;
      this.ty = this.y;
      this.visible = false;
      if (coarsePointer) return;
      window.addEventListener("mousemove", this.onMove, { passive: true });
    }

    onMove = (event) => {
      this.tx = event.clientX;
      this.ty = event.clientY;
      if (!this.visible) {
        this.x = this.tx;
        this.y = this.ty;
        this.visible = true;
        this.root.classList.add("is-on");
      }
    };

    lock(state) {
      this.root.classList.toggle("is-locked", state);
    }

    update() {
      if (coarsePointer) return;
      const nx = lerp(this.x, this.tx, reducedMotion ? 1 : 0.18);
      const ny = lerp(this.y, this.ty, reducedMotion ? 1 : 0.18);
      if (Math.abs(nx - this.x) < 0.05 && Math.abs(ny - this.y) < 0.05) {
        this.x = this.tx;
        this.y = this.ty;
        return;
      }
      this.x = nx;
      this.y = ny;
      this.root.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
    }
  }

  class Terminal {
    constructor(typed, hint, clock) {
      this.typed = typed;
      this.hint = hint;
      this.clock = clock;
      this.buffer = "[SYS_INIT] THOMAS ROLLAND | SONY A7V | 10mm, 16-35mm & 70-200mm";
      this.index = 0;
      this.done = false;
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
      const char = this.buffer.charAt(this.index);
      this.typed.textContent += char;
      this.index += 1;
      // Rythme mécanique : pauses plus longues sur les séparateurs.
      let delay = 16 + Math.random() * 28;
      if (char === " ") delay = 42;
      if (char === "|" || char === ".") delay = 140 + Math.random() * 80;
      window.setTimeout(this.type, delay);
    };

    finish() {
      this.typed.textContent = this.buffer;
      this.done = true;
      this.hint.classList.add("is-ready");
      if (this.onDone) this.onDone();
    }
  }

  class SmoothScroll {
    constructor(content) {
      this.content = content;
      this.current = 0;
      this.target = 0;
      /**
       * Coefficient d'easing du LERP.
       * 0.055–0.07 = friction lourde, organique, cinématique.
       * Plus la valeur est basse, plus la masse perçue est élevée.
       */
      this.ease = coarsePointer ? 0.12 : 0.058;
      this.max = 0;
      this.enabled = false;
      this.touchY = 0;
      this.written = 0;
      this.dirty = true;
    }

    enable() {
      this.enabled = true;
      this.content.style.willChange = "transform";
    }

    measure() {
      this.max = Math.max(0, this.content.scrollHeight - window.innerHeight);
      this.target = clamp(this.target, 0, this.max);
      this.current = clamp(this.current, 0, this.max);
      this.dirty = true;
    }

    add(delta) {
      if (!this.enabled) return;
      this.target = clamp(this.target + delta, 0, this.max);
      this.dirty = true;
    }

    onWheel = (event) => {
      event.preventDefault();
      this.add(event.deltaY);
    };

    onTouchStart = (event) => {
      this.touchY = event.touches[0].clientY;
    };

    onTouchMove = (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      const y = event.touches[0].clientY;
      this.add(this.touchY - y);
      this.touchY = y;
    };

    update() {
      const delta = this.target - this.current;
      // Évite une dérive infinie sous le seuil sub-pixel.
      if (Math.abs(delta) < 0.04) {
        this.current = this.target;
      } else {
        this.current = lerp(this.current, this.target, reducedMotion ? 1 : this.ease);
        this.dirty = true;
      }
      if (this.dirty || this.current !== this.written) {
        this.content.style.transform = `translate3d(0, ${-this.current}px, 0)`;
        this.written = this.current;
        this.dirty = false;
      }
      return this.current;
    }
  }

  class ParallaxField {
    constructor(nodes, content) {
      this.content = content;
      this.items = nodes.map((node) => ({
        node,
        speed: Number(node.dataset.speed) || 0,
        top: 0,
        height: 0,
      }));
    }

    measure() {
      this.items.forEach((item) => {
        item.node.style.transform = "none";
        item.top = offsetY(item.node, this.content);
        item.height = item.node.getBoundingClientRect().height;
      });
    }

    update(scrollY) {
      const vh = window.innerHeight;
      this.items.forEach((item) => {
        // Décalage relatif au centre du viewport.
        // speed > 0 : l'élément tarde (plus loin) ; speed < 0 : il précède.
        const center = item.top + item.height * 0.5;
        const distance = scrollY + vh * 0.5 - center;
        const y = reducedMotion ? 0 : distance * item.speed * -0.18;
        item.node.style.transform = `translate3d(0, ${y}px, 0)`;
      });
    }
  }

  class Interference {
    constructor(frames, displace) {
      this.frames = frames;
      this.displace = displace;
      this.hot = 0;
      this.seed = 4;
      this.frames.forEach((frame) => {
        frame.addEventListener("mouseenter", () => this.activate(frame));
        frame.addEventListener("mouseleave", () => this.release(frame));
      });
    }

    activate(frame) {
      frame.classList.add("is-hot");
      this.hot += 1;
    }

    release(frame) {
      frame.classList.remove("is-hot");
      this.hot = Math.max(0, this.hot - 1);
      if (this.hot === 0 && this.displace) this.displace.setAttribute("scale", "0");
    }

    update(time) {
      if (!this.displace || this.hot === 0 || reducedMotion) return;
      // Oscillation de l'amplitude de déplacement : simule la compression des basses.
      const pulse = 10 + Math.sin(time * 0.018) * 8 + Math.sin(time * 0.073) * 4;
      this.displace.setAttribute("scale", pulse.toFixed(2));
      if (Math.random() > 0.82) {
        this.seed += 1;
        const turbulence = document.getElementById("glitch-turbulence");
        if (turbulence) turbulence.setAttribute("seed", String(this.seed));
      }
    }
  }

  class Panorama {
    constructor(section, pin, track, label) {
      this.section = section;
      this.pin = pin;
      this.track = track;
      this.label = label;
      this.slides = [...track.querySelectorAll(".travel__slide")];
      this.start = 0;
      this.distance = 0;
      this.travel = 0;
    }

    measure(content) {
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      this.travel = Math.max(this.track.scrollWidth - vw, vw);
      // Hauteur extra = distance horizontale * 1.15 (pan un peu plus lent que le scroll).
      this.section.style.height = `${vh + this.travel * 1.15}px`;
      this.start = offsetY(this.section, content);
      this.distance = this.section.offsetHeight - vh;
    }

    update(scrollY) {
      const local = clamp(scrollY - this.start, 0, this.distance);
      // Sticky virtuel : on contre-translate le pin pour le figer dans le viewport
      // pendant que le parent (scroll-content) continue de monter.
      this.pin.style.transform = `translate3d(0, ${local}px, 0)`;
      const progress = this.distance ? local / this.distance : 0;
      const x = -progress * this.travel;
      this.track.style.transform = `translate3d(${x}px, 0, 0)`;

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
      this.strobe = document.getElementById("strobe");
      this.chrome = document.getElementById("chrome");
      this.counter = document.getElementById("counter");
      this.frameValue = document.getElementById("frame-value");
      this.ready = false;
      this.exposed = false;
      this.resizeRaf = 0;
      this.needRefit = false;
      this.frameLabel = "000";

      this.viewfinder = new Viewfinder(document.getElementById("viewfinder"));
      this.terminal = new Terminal(
        document.getElementById("typed"),
        document.getElementById("hint"),
        document.getElementById("loader-clock")
      );
      this.content = document.getElementById("scroll-content");
      this.scroll = new SmoothScroll(this.content);
      this.parallax = new ParallaxField([...document.querySelectorAll("[data-speed]")], this.content);
      this.interference = new Interference(
        [...document.querySelectorAll("[data-glitch]")],
        document.getElementById("glitch-displace")
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
      this.warmGallery();
      this.terminal.start();
      this.scheduleResize(true);
      if (document.fonts?.ready) document.fonts.ready.then(() => this.scheduleResize(true));
      this.loop(0);
    }

    bind() {
      const expose = () => this.expose();
      window.addEventListener("wheel", this.onWheel, { passive: false });
      window.addEventListener("touchstart", this.scroll.onTouchStart, { passive: true });
      window.addEventListener("touchmove", this.onTouch, { passive: false });
      window.addEventListener("keydown", this.onKey);
      this.loader.addEventListener("click", expose);
      window.addEventListener("resize", () => this.scheduleResize(true), { passive: true });

      document.querySelectorAll("[data-cursor='lock']").forEach((node) => {
        node.addEventListener("mouseenter", () => this.viewfinder.lock(true));
        node.addEventListener("mouseleave", () => this.viewfinder.lock(false));
      });

      document.querySelectorAll(".artists__grid img").forEach((img) => {
        if (!img.complete) {
          img.addEventListener("load", () => this.scheduleResize(false), { once: true });
        }
      });
    }

    warmGallery() {
      document.querySelectorAll(".artists__grid img").forEach((img) => {
        img.decoding = "async";
        if (img.decode) img.decode().catch(() => {});
      });
    }

    scheduleResize(refit) {
      this.needRefit = this.needRefit || refit;
      if (this.resizeRaf) return;
      this.resizeRaf = requestAnimationFrame(() => {
        this.resizeRaf = 0;
        const doFit = this.needRefit;
        this.needRefit = false;
        this.measure(doFit);
      });
    }

    onWheel = (event) => {
      event.preventDefault();
      if (!this.exposed) {
        if (this.ready) {
          this.expose();
          this.scroll.add(event.deltaY);
        }
        return;
      }
      this.scroll.add(event.deltaY);
    };

    onTouch = (event) => {
      event.preventDefault();
      if (!this.exposed) {
        if (this.ready) {
          this.expose();
          this.scroll.onTouchMove(event);
        }
        return;
      }
      this.scroll.onTouchMove(event);
    };

    onKey = (event) => {
      const keys = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Spacebar"];
      if (!keys.includes(event.key)) return;
      if (!this.exposed) {
        event.preventDefault();
        if (this.ready) this.expose();
        return;
      }
      event.preventDefault();
      const dir = event.key === "ArrowUp" || event.key === "PageUp" ? -1 : 1;
      const burst = event.key === "PageDown" || event.key === "PageUp" ? window.innerHeight : 140;
      this.scroll.add(dir * burst);
    };

    expose() {
      if (this.exposed || !this.ready) return;
      this.exposed = true;
      this.strobe.classList.add("is-fire");
      this.loader.classList.add("is-exposing");
      this.chrome.classList.add("is-live");
      this.counter.classList.add("is-live");
      this.scroll.enable();
      window.setTimeout(() => {
        this.loader.classList.add("is-gone");
      }, reducedMotion ? 0 : 800);
    }

    measure(refit) {
      this.panorama.measure(this.content);
      this.scroll.measure();
      this.parallax.measure();
      if (refit) this.fitTitle.fit();
    }

    loop = (time) => {
      const scrollY = this.scroll.update();
      this.viewfinder.update();
      if (this.exposed) {
        this.parallax.update(scrollY);
        this.panorama.update(scrollY);
        const frame = String(Math.round(mapRange(scrollY, 0, this.scroll.max || 1, 0, 36))).padStart(3, "0");
        if (frame !== this.frameLabel) {
          this.frameLabel = frame;
          this.frameValue.textContent = frame;
        }
      }
      this.interference.update(time);
      requestAnimationFrame(this.loop);
    };
  }

  const boot = () => new App();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
