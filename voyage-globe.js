(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NY = { lat: 40.7128, lon: -74.006 };

  class VoyageGlobe {
    constructor(container, popup) {
      this.container = container;
      this.popup = popup;
      this.closeBtn = document.getElementById("ny-pop-close");
      this.open = false;
      this.hot = false;
      this.radius = 1.2;
      this.baseSpeed = reducedMotion ? 0 : 0.0024;
      this.speed = this.baseSpeed;
      this.world = null;
      this.raf = 0;
      this.closeBtn?.addEventListener("click", this.onClose);

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
      this.showPopup(true);
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
      this.addMarker();
      this.loadContinents();

      this.raycaster = new THREE.Raycaster();
      this.pointerVec = new THREE.Vector2(2, 2);

      this.renderer.domElement.addEventListener("pointermove", this.onPointerMove);
      this.renderer.domElement.addEventListener("pointerleave", this.onPointerLeave);
      this.renderer.domElement.addEventListener("click", this.onClick);
      window.addEventListener("resize", this.resize, { passive: true });
      this.ro = new ResizeObserver(this.resize);
      this.ro.observe(this.container);
      this.resize();
      this.raf = requestAnimationFrame(this.tick);
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

    addMarker() {
      const ny = this.latLon(NY.lat, NY.lon, this.radius + 0.018);
      this.marker = new THREE.Group();
      const markMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f4 });
      const accentMat = new THREE.MeshBasicMaterial({ color: 0xff2f8b });
      this.marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.016, 0.016), markMat));
      this.marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.08, 0.016), markMat));
      this.marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.024, 0.024), accentMat));
      this.marker.add(
        new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.005, 8, 20), accentMat)
      );
      this.marker.position.copy(ny);
      this.marker.lookAt(ny.clone().multiplyScalar(2));
      this.planet.add(this.marker);

      this.hit = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 12, 12),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
      );
      this.hit.position.copy(ny);
      this.planet.add(this.hit);
      this.planet.rotation.y = -Math.atan2(ny.x, ny.z) + 0.28;
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
      if (this.hitsMarker()) this.setOpen(true);
      else this.setOpen(false);
    };

    onClose = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setOpen(false);
    };

    setHover(state) {
      if (this.hot === state) return;
      this.hot = state;
      this.container.classList.toggle("is-hot", state);
      document.documentElement.classList.toggle("is-globe-hot", state);
      if (this.marker) this.marker.scale.setScalar(state || this.open ? 1.4 : 1);
    }

    setOpen(state) {
      if (this.open === state) return;
      this.open = state;
      this.speed = reducedMotion ? 0 : state ? 0.0007 : this.baseSpeed;
      if (this.marker) this.marker.scale.setScalar(state || this.hot ? 1.4 : 1);
      this.showPopup(state);
    }

    showPopup(state) {
      if (!this.popup) return;
      this.popup.classList.toggle("is-on", state);
      this.popup.setAttribute("aria-hidden", state ? "false" : "true");
      this.popup.style.transform = "";
      document.documentElement.classList.toggle("is-globe-open", state);
    }

    hitsMarker() {
      if (!this.raycaster || !this.hit) return false;
      this.raycaster.setFromCamera(this.pointerVec, this.camera);
      return this.raycaster.intersectObject(this.hit, false).length > 0;
    }

    tick = () => {
      this.raf = requestAnimationFrame(this.tick);
      if (this.planet) {
        this.planet.rotation.y += this.speed;
        this.setHover(this.hitsMarker());
      }
      if (this.renderer) this.renderer.render(this.scene, this.camera);
    };

    resize = () => {
      if (!this.renderer || !this.container) return;
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;
      if (!width || !height) return;
      this.camera.aspect = width / height;
      this.fitCamera();
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(width, height, false);
    };
  }

  const boot = () => {
    const container = document.getElementById("globe-container");
    if (!container) return;
    new VoyageGlobe(container, document.getElementById("ny-pop"));
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
