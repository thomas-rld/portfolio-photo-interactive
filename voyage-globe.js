(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const DESTINATIONS = [
    {
      id: "new-york",
      name: "NEW YORK",
      lat: 40.7128,
      lon: -74.006,
      gallery: "ny-pop",
      hint: "40.7128 N · 74.0060 W\nNEW YORK · CLICK MARKER",
      preview: "photos/photos/new-york/DSC00366.jpg",
      featured: true,
    },
    // Nouvelle ville : une entrée ici + un bloc HTML .globe-pop dont l'id = gallery.
    // { id: "paris", name: "PARIS", lat: 48.8566, lon: 2.3522, gallery: "paris-pop", preview: "photos/paris/cover.jpg", hint: "PARIS · CLICK MARKER" },
  ];

  const AUTO_GAP = 10000;
  const AUTO_HOLD = 3000;

  class VoyageGlobe {
    constructor(container) {
      this.container = container;
      this.hud = document.getElementById("globe-hud");
      this.preview = document.getElementById("globe-preview");
      this.previewImg = document.getElementById("globe-preview-img");
      this.previewLabel = document.getElementById("globe-preview-label");
      this.shownPreview = null;
      this.open = false;
      this.autoOpen = false;
      this.cycleStopped = false;
      this.sectionVisible = false;
      this.cycleTimer = 0;
      this.holdTimer = 0;
      this.closeToken = 0;
      this.hot = false;
      this.active = null;
      this.pins = [];
      this.radius = 1.2;
      this.baseSpeed = reducedMotion ? 0 : 0.0024;
      this.speed = this.baseSpeed;
      this.world = null;
      this.raf = 0;

      document.querySelectorAll(".globe-pop__close").forEach((btn) => {
        btn.addEventListener("click", this.onClose);
      });
      DESTINATIONS.forEach((item) => {
        this.gallery(item)
          ?.querySelector(".globe-pop__panel")
          ?.addEventListener("click", this.onPanelClick);
      });
      this.preview?.addEventListener("click", this.onPreviewClick);
      document.addEventListener("visibilitychange", this.onPageVisibility);

      if (typeof THREE === "undefined") {
        this.fallback();
        return;
      }

      try {
        this.mount();
      } catch (error) {
        this.container.dataset.error = String(error && error.message ? error.message : error);
        this.fallback();
      }
    }

    gallery(dest) {
      return dest ? document.getElementById(dest.gallery) : null;
    }

    latLon(lat, lon, radius) {
      const phi = (90 - lat) * (Math.PI / 180);
      const theta = (lon + 180) * (Math.PI / 180);
      return new THREE.Vector3(
        -radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.sin(theta)
      );
    }

    fallback() {
      this.container.classList.add("is-fallback");
      const featured = this.featured();
      this.openGallery(featured);
    }

    mount() {
      const width = this.container.clientWidth || 1;
      const height = this.container.clientHeight || 1;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 40);
      this.world = new THREE.Vector3();

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(width, height, false);
      this.container.appendChild(this.renderer.domElement);

      this.planet = new THREE.Group();
      this.scene.add(this.planet);
      this.addRadarCage();
      this.addPins();
      this.loadContinents();

      this.raycaster = new THREE.Raycaster();
      this.pointerVec = new THREE.Vector2(2, 2);

      this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
      this.renderer.domElement.addEventListener("pointerleave", this.onPointerLeave);
      this.renderer.domElement.addEventListener("click", this.onClick);
      window.addEventListener("resize", this.resize, { passive: true });
      window.addEventListener("orientationchange", this.resize, { passive: true });
      this.ro = new ResizeObserver(this.resize);
      this.ro.observe(this.container);
      this.resize();
      this.observeCycle();
      this.raf = requestAnimationFrame(this.tick);
    }

    featured() {
      return DESTINATIONS.find((item) => item.featured) || DESTINATIONS[0];
    }

    addRadarCage() {
      const faint = new THREE.MeshBasicMaterial({
        color: 0xf4f4f4,
        wireframe: true,
        transparent: true,
        opacity: 0.045,
      });
      this.planet.add(new THREE.Mesh(new THREE.SphereGeometry(this.radius, 24, 16), faint));

      const meridians = [];
      const steps = 64;
      for (let m = 0; m < 6; m += 1) {
        const lon = -180 + m * 30;
        for (let i = 0; i < steps; i += 1) {
          const a = this.latLon(-90 + (180 * i) / steps, lon, this.radius);
          const b = this.latLon(-90 + (180 * (i + 1)) / steps, lon, this.radius);
          meridians.push(a.x, a.y, a.z, b.x, b.y, b.z);
        }
      }
      for (let i = 0; i < steps; i += 1) {
        const a = this.latLon(0, -180 + (360 * i) / steps, this.radius);
        const b = this.latLon(0, -180 + (360 * (i + 1)) / steps, this.radius);
        meridians.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
      const grid = new THREE.BufferGeometry();
      grid.setAttribute("position", new THREE.Float32BufferAttribute(meridians, 3));
      this.planet.add(
        new THREE.LineSegments(
          grid,
          new THREE.LineBasicMaterial({ color: 0x6a6a6a, transparent: true, opacity: 0.18 })
        )
      );
    }

    addPins() {
      const markMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f4 });
      const accentMat = new THREE.MeshBasicMaterial({ color: 0xff2f8b });

      DESTINATIONS.forEach((dest) => {
        const pos = this.latLon(dest.lat, dest.lon, this.radius + 0.018);
        const marker = new THREE.Group();
        marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.016, 0.016), markMat));
        marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.08, 0.016), markMat));
        marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.028), accentMat.clone()));
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.07, 0.006, 8, 24),
          new THREE.MeshBasicMaterial({
            color: 0xff2f8b,
            transparent: true,
            opacity: 0.95,
          })
        );
        marker.add(ring);
        marker.position.copy(pos);
        marker.lookAt(pos.clone().multiplyScalar(2));
        marker.userData.destination = dest;
        this.planet.add(marker);

        const hit = new THREE.Mesh(
          new THREE.SphereGeometry(0.22, 12, 12),
          new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
        );
        hit.position.copy(pos);
        hit.userData.destination = dest;
        this.planet.add(hit);

        this.pins.push({ dest, marker, hit, ring });
      });

      const face = this.pins.find((pin) => pin.dest.featured) || this.pins[0];
      if (face) {
        this.planet.rotation.y = -Math.atan2(face.marker.position.x, face.marker.position.z) + 0.28;
      }
    }

    loadContinents() {
      fetch("data/land-110m.json")
        .then((response) => {
          if (!response.ok) throw new Error("land map missing");
          return response.json();
        })
        .then((geo) => this.drawContinents(geo))
        .catch(() => this.drawWireFallback());
    }

    drawWireFallback() {
      this.planet.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(this.radius, 36, 22),
          new THREE.MeshBasicMaterial({
            color: 0xf4f4f4,
            wireframe: true,
            transparent: true,
            opacity: 0.28,
          })
        )
      );
    }

    drawContinents(geo) {
      const lines = [];
      const dots = [];
      const pushRing = (ring) => {
        if (!ring || ring.length < 2) return;
        let prev = null;
        let first = null;
        ring.forEach(([lon, lat], index) => {
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
          const point = this.latLon(lat, lon, this.radius + 0.002);
          if (!first) first = point.clone();
          if (prev) {
            lines.push(prev.x, prev.y, prev.z, point.x, point.y, point.z);
          }
          if (index % 2 === 0) dots.push(point.x, point.y, point.z);
          prev = point;
        });
        if (prev && first) lines.push(prev.x, prev.y, prev.z, first.x, first.y, first.z);
      };
      const walk = (coords) => {
        if (!coords || !coords.length) return;
        if (typeof coords[0][0] === "number") pushRing(coords);
        else coords.forEach(walk);
      };
      (geo.features || []).forEach((feature) => {
        walk(feature.geometry && feature.geometry.coordinates);
      });

      const coast = new THREE.BufferGeometry();
      coast.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
      this.planet.add(
        new THREE.LineSegments(
          coast,
          new THREE.LineBasicMaterial({ color: 0xf4f4f4, transparent: true, opacity: 0.82 })
        )
      );

      const cloud = new THREE.BufferGeometry();
      cloud.setAttribute("position", new THREE.Float32BufferAttribute(dots, 3));
      this.planet.add(
        new THREE.Points(
          cloud,
          new THREE.PointsMaterial({
            color: 0xe8e8e8,
            size: 0.012,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.7,
          })
        )
      );
    }

    observeCycle() {
      if (reducedMotion || !("IntersectionObserver" in window)) return;
      const section = document.getElementById("voyage") || this.container;
      this.cycleObserver = new IntersectionObserver(
        (entries) => {
          this.sectionVisible = Boolean(entries[0]?.isIntersecting);
          if (this.cycleStopped) return;
          if (this.sectionVisible) {
            if (!this.open) this.scheduleCycle(AUTO_GAP);
            return;
          }
          this.clearCycleTimers();
          if (this.autoOpen) this.closeGallery({ reason: "auto" });
        },
        { threshold: 0.32 }
      );
      this.cycleObserver.observe(section);
    }

    onPageVisibility = () => {
      if (this.cycleStopped) return;
      if (document.hidden) {
        this.clearCycleTimers();
        if (this.autoOpen) this.closeGallery({ reason: "auto" });
        return;
      }
      if (this.sectionVisible && !this.open) this.scheduleCycle(AUTO_GAP);
    };

    clearCycleTimers() {
      window.clearTimeout(this.cycleTimer);
      window.clearTimeout(this.holdTimer);
      this.cycleTimer = 0;
      this.holdTimer = 0;
    }

    stopCycle() {
      this.cycleStopped = true;
      this.autoOpen = false;
      this.clearCycleTimers();
    }

    scheduleCycle(delay) {
      if (this.cycleStopped || reducedMotion || !this.sectionVisible || document.hidden || this.open) {
        return;
      }
      this.clearCycleTimers();
      this.cycleTimer = window.setTimeout(this.autoPop, delay);
    }

    autoPop = () => {
      if (this.cycleStopped || !this.sectionVisible || document.hidden || this.open) return;
      const dest = this.featured();
      if (!dest) return;
      this.openGallery(dest, { auto: true });
      this.holdTimer = window.setTimeout(() => {
        if (this.cycleStopped || !this.autoOpen) return;
        this.closeGallery({ reason: "auto" });
      }, AUTO_HOLD);
    };

    fitCamera() {
      const aspect = this.camera.aspect || 1;
      const half = ((this.camera.fov * Math.PI) / 180) * 0.5;
      const fitH = this.radius / Math.tan(half);
      const fitW = this.radius / (Math.tan(half) * aspect);
      this.camera.position.set(0, 0, Math.max(fitH, fitW) * 1.2);
      this.camera.far = this.camera.position.z + this.radius * 6;
      this.camera.updateProjectionMatrix();
    }

    onPointerMove = (event) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointerVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    onPointerLeave = () => {
      this.pointerVec.set(2, 2);
      this.setHover(false);
    };

    onClick = (event) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointerVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      const dest = this.hitsPin();
      if (dest) this.openGallery(dest);
      else if (this.autoOpen) return;
      else if (this.open) this.closeGallery({ reason: "user" });
    };

    onClose = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.closeGallery({ reason: "user" });
    };

    onPanelClick = (event) => {
      if (event.target.closest(".globe-pop__close")) return;
      if (!this.open || !this.autoOpen) return;
      event.stopPropagation();
      this.openGallery(this.active);
    };

    onPreviewClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.shownPreview) this.openGallery(this.shownPreview);
    };

    hidePreview() {
      this.shownPreview = null;
      this.preview?.classList.remove("is-on");
      this.preview?.setAttribute("aria-hidden", "true");
    }

    bindPreview(dest) {
      if (!dest || this.shownPreview === dest) return;
      this.shownPreview = dest;
      if (this.previewImg && dest.preview) {
        this.previewImg.src = dest.preview;
        this.previewImg.alt = dest.name;
      }
      if (this.previewLabel) this.previewLabel.textContent = `[ APERÇU : ${dest.name} ]`;
      this.preview?.setAttribute("aria-label", `Aperçu ${dest.name}`);
    }

    updatePreview() {
      if (this.open || !this.preview || !this.camera) {
        if (this.shownPreview) this.hidePreview();
        return;
      }
      this.camera.updateMatrixWorld();
      const camLen = this.camera.position.length();
      let best = null;
      let bestFacing = -Infinity;
      this.pins.forEach((pin) => {
        pin.marker.getWorldPosition(this.world);
        const facing = this.world.dot(this.camera.position);
        const keep = this.shownPreview && this.shownPreview.id === pin.dest.id;
        const cutoff = this.radius * camLen * (keep ? 0.18 : 0.38);
        if (facing < cutoff) return;
        if (facing > bestFacing) {
          best = pin;
          bestFacing = facing;
        }
      });
      if (!best) {
        this.hidePreview();
        return;
      }
      this.bindPreview(best.dest);
      best.marker.getWorldPosition(this.world);
      this.world.project(this.camera);
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      const cardW = this.preview.offsetWidth || 152;
      const cardH = this.preview.offsetHeight || 130;
      const x = Math.min(Math.max(8, (this.world.x * 0.5 + 0.5) * width + 16), Math.max(8, width - cardW - 8));
      const y = Math.min(Math.max(8, (-this.world.y * 0.5 + 0.5) * height - cardH * 0.62), Math.max(8, height - cardH - 8));
      this.preview.style.left = `${x}px`;
      this.preview.style.top = `${y}px`;
      this.preview.classList.add("is-on");
      this.preview.setAttribute("aria-hidden", "false");
    }

    setHover(state) {
      if (this.hot === state) return;
      this.hot = state;
      this.container.classList.toggle("is-hot", state);
      document.documentElement.classList.toggle("is-globe-hot", state);
      const dest = this.hitsPin();
      if (dest && this.hud) this.hud.innerHTML = dest.hint.replace("\n", "<br />");
    }

    openGallery(dest, opts = {}) {
      if (!dest) return;
      const auto = Boolean(opts.auto);
      if (!auto) this.stopCycle();
      this.closeToken += 1;

      if (this.open && this.active?.id === dest.id) {
        this.autoOpen = false;
        this.gallery(dest)?.classList.remove("is-auto");
        document.documentElement.classList.add("is-globe-open");
        this.speed = reducedMotion ? 0 : 0.0007;
        this.scaleActivePin();
        return;
      }

      this.hidePreview();
      this.active = dest;
      this.open = true;
      this.autoOpen = auto;
      this.speed = reducedMotion ? 0 : auto ? this.baseSpeed : 0.0007;
      DESTINATIONS.forEach((item) => {
        const node = this.gallery(item);
        if (!node) return;
        const on = item.id === dest.id;
        node.classList.remove("is-leaving", "is-on", "is-auto");
        node.style.transform = "";
        if (!on) {
          node.setAttribute("aria-hidden", "true");
          return;
        }
        void node.offsetWidth;
        node.classList.add("is-on");
        if (auto) node.classList.add("is-auto");
        node.setAttribute("aria-hidden", "false");
      });
      document.documentElement.classList.toggle("is-globe-open", !auto);
      this.scaleActivePin();
    }

    closeGallery(opts = {}) {
      if (!this.open) return;
      const reason = opts.reason || "user";
      if (reason === "user") this.stopCycle();
      else this.autoOpen = false;

      this.open = false;
      this.active = null;
      this.speed = this.baseSpeed;
      document.documentElement.classList.remove("is-globe-open");
      const token = ++this.closeToken;
      DESTINATIONS.forEach((item) => {
        const node = this.gallery(item);
        if (!node) return;
        if (!node.classList.contains("is-on")) {
          node.classList.remove("is-on", "is-auto", "is-leaving");
          node.setAttribute("aria-hidden", "true");
          return;
        }
        node.classList.remove("is-on", "is-auto");
        node.classList.add("is-leaving");
        const panel = node.querySelector(".globe-pop__panel");
        const finish = (event) => {
          if (token !== this.closeToken) return;
          if (event && event.animationName && event.animationName !== "globe-collapse") return;
          node.classList.remove("is-leaving");
          node.setAttribute("aria-hidden", "true");
          panel?.removeEventListener("animationend", finish);
        };
        panel?.addEventListener("animationend", finish);
        window.setTimeout(finish, 480);
      });
      this.scaleActivePin();
      if (reason === "auto" && !this.cycleStopped) this.scheduleCycle(AUTO_GAP);
    }

    scaleActivePin() {
      this.pins.forEach((pin) => {
        const live = this.hot || (this.open && this.active && pin.dest.id === this.active.id);
        pin.marker.scale.setScalar(live ? 1.4 : 1);
      });
    }

    hitsPin() {
      if (!this.raycaster || !this.pins.length) return null;
      this.raycaster.setFromCamera(this.pointerVec, this.camera);
      const hits = this.raycaster.intersectObjects(
        this.pins.map((pin) => pin.hit),
        false
      );
      return hits[0]?.object.userData.destination || null;
    }

    tick = () => {
      this.raf = requestAnimationFrame(this.tick);
      if (this.planet) {
        this.planet.rotation.y += this.speed;
        this.setHover(Boolean(this.hitsPin()));
        this.scaleActivePin();
        this.updatePreview();
      }
      if (this.renderer) this.renderer.render(this.scene, this.camera);
    };

    resize = () => {
      if (!this.renderer || !this.container) return;
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (!width || !height) return;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.fitCamera();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(width, height, false);
    };
  }

  const boot = () => {
    const container = document.getElementById("globe-container");
    if (!container) return;
    new VoyageGlobe(container);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
