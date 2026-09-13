(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  class VoyageGlobe {
    constructor({ container, modal, lockBtn, closeBtn }) {
      this.container = container;
      this.modal = modal;
      this.lockBtn = lockBtn;
      this.closeBtn = closeBtn;
      this.open = false;
      this.hot = false;
      this.baseSpeed = reducedMotion ? 0 : 0.0032;
      this.speed = this.baseSpeed;
      this.raf = 0;

      this.closeBtn?.addEventListener("click", this.closeModal);
      this.lockBtn?.addEventListener("click", this.openModal);
      window.addEventListener("keydown", this.onKey);

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
      if (!this.container || this.container.querySelector(".globe__fallback")) return;
      this.container.classList.add("is-fallback");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "globe__fallback";
      button.textContent = "NEW YORK — OPEN ROLL";
      button.addEventListener("click", this.openModal);
      this.container.appendChild(button);
    }

    mount() {
      const width = this.container.clientWidth || 1;
      const height = this.container.clientHeight || 1;
      const radius = 1.28;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 20);
      this.camera.position.set(0, 0.12, 3.35);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(width, height, false);
      this.container.appendChild(this.renderer.domElement);

      this.planet = new THREE.Group();
      this.scene.add(this.planet);

      const sphereGeo = new THREE.SphereGeometry(radius, 28, 16);
      this.planet.add(
        new THREE.Mesh(
          sphereGeo,
          new THREE.MeshBasicMaterial({
            color: 0xf4f4f4,
            wireframe: true,
            transparent: true,
            opacity: 0.42,
          })
        ),
        new THREE.Points(
          sphereGeo,
          new THREE.PointsMaterial({
            color: 0xe8e8e8,
            size: 0.02,
            sizeAttenuation: true,
          })
        )
      );

      const ny = this.latLon(40.7128, -74.006, radius + 0.02);
      this.marker = new THREE.Group();
      const markMat = new THREE.MeshBasicMaterial({ color: 0xf4f4f4 });
      const accentMat = new THREE.MeshBasicMaterial({ color: 0xff2f8b });
      this.marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.018, 0.018), markMat));
      this.marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.09, 0.018), markMat));
      this.marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.028), accentMat));
      this.marker.position.copy(ny);
      this.marker.lookAt(ny.clone().multiplyScalar(2));
      this.planet.add(this.marker);

      this.marker.add(
        new THREE.Mesh(
          new THREE.TorusGeometry(0.08, 0.006, 8, 20),
          new THREE.MeshBasicMaterial({ color: 0xff2f8b })
        )
      );

      this.hit = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 12, 12),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        })
      );
      this.hit.position.copy(ny);
      this.planet.add(this.hit);
      this.planet.rotation.y = -Math.atan2(ny.x, ny.z) + 0.35;

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

    onPointerMove = (event) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointerVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    onPointerLeave = () => {
      this.pointerVec.set(2, 2);
      this.setHot(false);
    };

    onClick = (event) => {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.pointerVec.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerVec.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      if (this.hitsMarker()) this.openModal();
    };

    onKey = (event) => {
      if (event.key === "Escape" && this.open) this.closeModal();
    };

    setHot(state) {
      if (this.hot === state) return;
      this.hot = state;
      this.container.classList.toggle("is-hot", state);
      document.documentElement.classList.toggle("is-globe-hot", state);
      this.speed = reducedMotion ? 0 : state ? 0.0006 : this.baseSpeed;
      if (this.marker) this.marker.scale.setScalar(state ? 1.45 : 1);
    }

    hitsMarker() {
      if (!this.raycaster || !this.hit) return false;
      this.raycaster.setFromCamera(this.pointerVec, this.camera);
      return this.raycaster.intersectObject(this.hit, false).length > 0;
    }

    pick() {
      this.setHot(this.hitsMarker());
    }

    tick = () => {
      this.raf = requestAnimationFrame(this.tick);
      if (this.planet && !this.open) {
        this.planet.rotation.y += this.speed;
        this.pick();
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
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(width, height, false);
    };

    openModal = () => {
      if (!this.modal || this.open) return;
      this.open = true;
      this.setHot(false);
      this.modal.classList.add("is-open");
      this.modal.setAttribute("aria-hidden", "false");
      document.documentElement.classList.add("is-voyage-open");
      document.body.style.overflow = "hidden";
      this.modal.querySelectorAll(".shot").forEach((shot) => shot.classList.add("is-in"));
      this.closeBtn?.focus();
    };

    closeModal = () => {
      if (!this.modal || !this.open) return;
      this.open = false;
      this.modal.classList.remove("is-open");
      this.modal.setAttribute("aria-hidden", "true");
      document.documentElement.classList.remove("is-voyage-open");
      document.body.style.overflow = "auto";
    };
  }

  const boot = () => {
    const container = document.getElementById("globe-container");
    const modal = document.getElementById("voyage-modal");
    if (!container || !modal) return;
    new VoyageGlobe({
      container,
      modal,
      lockBtn: document.getElementById("globe-lock"),
      closeBtn: document.getElementById("voyage-modal-close"),
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
