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

  class BootLog {
    constructor(root, clock) {
      this.root = root;
      this.clock = clock;
      this.lines = [
        "> SYSTEM BOOT...",
        "> LOADING KERNEL_A7V...",
        "> LOADING WEBGL_EARTH...",
        "> MOUNTING DIRECTORIES...",
        "> INDEXING /PHOTOS...",
        "> ACCESS GRANTED.",
      ];
      this.index = 0;
      this.clockTimer = 0;
      this.lineTimer = 0;
      this.onDone = null;
    }

    start() {
      this.tickClock();
      this.clockTimer = window.setInterval(this.tickClock, 1000);
      if (reducedMotion) {
        this.dumpAll();
        this.finish();
        return;
      }
      this.next();
    }

    dumpAll() {
      if (!this.root) return;
      this.root.innerHTML = this.lines.map((line) => `<p>${line}</p>`).join("");
    }

    next() {
      if (!this.root || this.index >= this.lines.length) {
        this.finish();
        return;
      }
      const line = document.createElement("p");
      line.textContent = this.lines[this.index];
      if (this.index === this.lines.length - 1) line.classList.add("is-ok");
      this.root.appendChild(line);
      this.index += 1;
      this.lineTimer = window.setTimeout(() => this.next(), 260);
    }

    tickClock = () => {
      if (!this.clock) return;
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      this.clock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    };

    finish() {
      this.stop();
      if (this.onDone) this.onDone();
    }

    stop() {
      if (this.lineTimer) {
        window.clearTimeout(this.lineTimer);
        this.lineTimer = 0;
      }
      if (this.clockTimer) {
        window.clearInterval(this.clockTimer);
        this.clockTimer = 0;
      }
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
      this.boot = new BootLog(
        document.getElementById("loader-boot"),
        document.getElementById("loader-clock")
      );
      this.panorama = new Panorama(
        document.getElementById("voyage"),
        document.getElementById("travel-pin"),
        document.getElementById("travel-track"),
        document.getElementById("travel-place")
      );
      this.fitTitle = new FitTitle(document.querySelector(".hero-title"));
      this.bootDone = false;
      this.pageLoaded = document.readyState === "complete";
      this.failSafe = 0;

      this.boot.onDone = () => {
        this.bootDone = true;
        this.tryExpose();
      };

      this.bind();
      this.observeShots();
      this.loader?.classList.add("is-armed");
      this.boot.start();
      this.failSafe = window.setTimeout(() => this.expose(), 2500);
      window.addEventListener("load", this.onPageLoad);
      this.scheduleResize();
      if (document.fonts?.ready) document.fonts.ready.then(() => this.scheduleResize());
    }

    onPageLoad = () => {
      this.pageLoaded = true;
      this.tryExpose();
    };

    tryExpose() {
      if (this.bootDone && this.pageLoaded) this.expose();
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
      if (!this.exposed) {
        event.preventDefault();
        this.expose();
      }
    };

    onKey = (event) => {
      const keys = ["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Spacebar", "Enter", "Escape"];
      if (!keys.includes(event.key)) return;
      if (!this.exposed) {
        event.preventDefault();
        this.expose();
      }
    };

    expose() {
      if (this.exposed) return;
      this.exposed = true;
      this.ready = true;
      window.clearTimeout(this.failSafe);
      window.removeEventListener("load", this.onPageLoad);
      this.loader.classList.add("is-exposing");
      this.chrome.classList.add("is-live");
      this.counter.classList.add("is-live");
      this.boot.stop();
      document.documentElement.classList.remove("is-locked");
      window.removeEventListener("wheel", this.onFirstScroll);
      window.removeEventListener("touchmove", this.onFirstScroll);
      window.setTimeout(() => {
        this.loader.classList.add("is-gone");
        this.loader.setAttribute("aria-busy", "false");
      }, reducedMotion ? 0 : 450);
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
