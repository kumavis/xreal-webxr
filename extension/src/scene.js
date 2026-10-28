import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const status = document.querySelector("#status");
const enter = document.querySelector("#enter");
const pause = document.querySelector("#pause");
const report = (message, error = false) => {
  status.textContent = message;
  status.dataset.error = String(error);
};

try {
  start();
} catch (error) {
  enter.textContent = "Scene unavailable";
  report(error.message, true);
}

function start() {
  const renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector("#scene"),
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07101d);
  scene.fog = new THREE.FogExp2(0x07101d, 0.025);
  const camera = new THREE.PerspectiveCamera(
    55,
    innerWidth / innerHeight,
    0.05,
    80,
  );
  camera.position.set(0, 1.2, 0);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, -3.5);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 1;
  controls.maxDistance = 10;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xa4dfff, 0x1c1726, 2));
  const sun = new THREE.DirectionalLight(0xffe5c5, 4);
  sun.position.set(3, 7, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, {
    left: -10,
    right: 10,
    top: 10,
    bottom: -10,
    far: 30,
  });
  sun.shadow.bias = -0.0003;
  scene.add(sun);

  const materials = {
    stone: new THREE.MeshStandardMaterial({
      color: 0x1a2a3b,
      roughness: 0.7,
      metalness: 0.2,
    }),
    brass: new THREE.MeshStandardMaterial({
      color: 0xe2af69,
      roughness: 0.3,
      metalness: 0.65,
    }),
    teal: new THREE.MeshStandardMaterial({
      color: 0x5de6d2,
      emissive: 0x0a524c,
      emissiveIntensity: 0.55,
      roughness: 0.3,
      metalness: 0.25,
    }),
    violet: new THREE.MeshStandardMaterial({
      color: 0xb799ff,
      emissive: 0x30215d,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.3,
    }),
    orange: new THREE.MeshStandardMaterial({
      color: 0xffaa71,
      emissive: 0x6e2611,
      emissiveIntensity: 0.45,
      roughness: 0.35,
      metalness: 0.2,
    }),
  };
  function mesh(geometry, material, position, parent = scene) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function ring(radius, material, position, parent = scene) {
    const object = mesh(
      new THREE.TorusGeometry(radius, 0.018, 8, 80),
      material,
      position,
      parent,
    );
    object.castShadow = false;
    return object;
  }
  function label(text, position, color = "#afd8df", width = 1.6) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext("2d");
    ctx.font = "500 28px system-ui";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 48);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
      }),
    );
    sprite.position.set(...position);
    sprite.scale.set(width, (width * 96) / 512, 1);
    scene.add(sprite);
  }

  const floor = mesh(
    new THREE.CircleGeometry(20, 96),
    materials.stone,
    [0, -0.015, 0],
  );
  floor.rotation.x = -Math.PI / 2;
  floor.castShadow = false;
  const grid = new THREE.GridHelper(30, 30, 0x377b89, 0x203f52);
  grid.position.y = 0.002;
  scene.add(grid);
  for (const radius of [2, 4, 8, 12]) {
    const line = ring(radius, materials.teal, [0, 0.015, 0]);
    line.rotation.x = -Math.PI / 2;
  }

  // The room is built around the fixed viewer at (0, 1.2, 0).
  mesh(
    new THREE.CylinderGeometry(0.6, 0.72, 0.32, 48),
    materials.stone,
    [0, 0.16, -3.5],
  );
  const sculpture = new THREE.Group();
  sculpture.position.set(0, 1.45, -3.5);
  scene.add(sculpture);
  const core = mesh(
    new THREE.IcosahedronGeometry(0.3, 1),
    materials.teal,
    [0, 0, 0],
    sculpture,
  );
  const orbits = [0.58, 0.79, 1.02].map((radius, i) => {
    const pivot = new THREE.Group();
    sculpture.add(pivot);
    pivot.rotation.set(i * 0.7, i * 0.6, i * 0.4);
    ring(radius, i === 1 ? materials.teal : materials.brass, [0, 0, 0], pivot);
    mesh(
      new THREE.SphereGeometry(0.075, 20, 12),
      materials.orange,
      [radius, 0, 0],
      pivot,
    );
    return pivot;
  });
  label("KINETIC ORBITS / 3.5 m", [0, 0.55, -3.5], "#ebc794", 2);

  const objects = [];
  for (const [x, z, material, geometry, title] of [
    [
      -0.8,
      -1.7,
      materials.violet,
      new THREE.OctahedronGeometry(0.2),
      "NEAR / 1.9 m",
    ],
    [
      0.95,
      -2.1,
      materials.orange,
      new THREE.TorusKnotGeometry(0.17, 0.055, 80, 12),
      "WOVEN / 2.3 m",
    ],
    [
      -2.6,
      -4.7,
      materials.teal,
      new THREE.DodecahedronGeometry(0.38),
      "FACETS / 5.4 m",
    ],
    [
      2.9,
      -5.4,
      materials.violet,
      new THREE.IcosahedronGeometry(0.4, 0),
      "DISTANT / 6.1 m",
    ],
  ]) {
    mesh(new THREE.CylinderGeometry(0.25, 0.34, 0.65, 32), materials.stone, [
      x,
      0.325,
      z,
    ]);
    const object = mesh(geometry, material, [x, 1.15, z]);
    objects.push(object);
    label(title, [x, 0.73, z], "#bdd2e5", 1.1);
  }

  // Architectural landmarks continue behind the viewer for a full look-around scene.
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    const x = Math.sin(angle) * 11,
      z = Math.cos(angle) * 11;
    mesh(new THREE.BoxGeometry(0.18, 3.8, 0.18), materials.stone, [x, 1.9, z]);
    mesh(
      new THREE.BoxGeometry(0.035, 2.8, 0.035),
      i % 2 ? materials.teal : materials.violet,
      [x * 0.995, 1.8, z * 0.995],
    );
  }
  const rim = ring(11, materials.brass, [0, 3.8, 0]);
  rim.rotation.x = -Math.PI / 2;
  label("ORBIT ROOM", [0, 2.8, -9], "#b0e9e3", 4);
  label("LOOK AROUND", [0, 1.4, 8], "#b0e9e3", 3);

  let seed = 71;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stars = new Float32Array(900);
  for (let i = 0; i < 300; i++) {
    const a = random() * Math.PI * 2,
      height = 4 + random() * 15,
      radius = 16 + random() * 14;
    stars.set([Math.sin(a) * radius, height, Math.cos(a) * radius], i * 3);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
  scene.add(
    new THREE.Points(
      starGeometry,
      new THREE.PointsMaterial({
        color: 0xb7d5ff,
        size: 0.04,
        sizeAttenuation: true,
      }),
    ),
  );

  let paused = false,
    elapsed = 0,
    previous = null,
    session = null;
  let enteredFullscreen = false;
  const togglePause = () => {
    paused = !paused;
    pause.textContent = paused ? "Resume motion" : "Pause motion";
  };
  pause.onclick = togglePause;
  window.addEventListener("keydown", (event) => {
    if (event.code === "Escape") {
      session?.end();
      return;
    }
    if (
      event
        .composedPath()
        .some((node) => ["INPUT", "BUTTON", "TEXTAREA"].includes(node.tagName))
    )
      return;
    if (event.code === "Space") {
      event.preventDefault();
      togglePause();
    }
  });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) session?.end();
  });
  window.addEventListener("resize", () => {
    if (renderer.xr.isPresenting) return;
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  renderer.xr.addEventListener("sessionstart", () => {
    controls.enabled = false;
    document.body.classList.add("xr");
    const toolbar = document.querySelector("#xreal-webxr-toolbar");
    if (toolbar) toolbar.style.visibility = "hidden";
  });
  renderer.xr.addEventListener("sessionend", () => {
    session = null;
    controls.enabled = true;
    document.body.classList.remove("xr");
    const toolbar = document.querySelector("#xreal-webxr-toolbar");
    if (toolbar) toolbar.style.visibility = "visible";
    enter.disabled = false;
    enter.textContent = "Fullscreen + Enter VR";
    report("VR ended. Connect and enter again when ready.");
    if (enteredFullscreen && document.fullscreenElement)
      document.exitFullscreen().catch(() => {});
    enteredFullscreen = false;
  });
  enter.disabled = false;
  enter.textContent = "Fullscreen + Enter VR";
  report(
    "Scene ready. Wait for Tracking in the XREAL toolbar, then enter VR. Drag to look around in desktop preview.",
  );
  window.postMessage(
    { source: "xreal-page", command: "connect" },
    location.origin,
  );

  enter.onclick = async () => {
    enter.disabled = true;
    enter.textContent = "Starting VR…";
    report("Starting fullscreen and a tracked stereo session…");
    try {
      if (!navigator.xr)
        throw new Error("Reload the XREAL extension and this page first.");
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        enteredFullscreen = true;
      }
      // Resize before IWER takes the canvas for its eye viewports.
      renderer.setSize(innerWidth, innerHeight);
      session = await navigator.xr.requestSession("immersive-vr", {
        requiredFeatures: ["local-floor"],
      });
      await renderer.xr.setSession(session);
      enter.textContent = "VR running";
      report("VR running — Alt+R recenters, Space pauses, Escape exits.");
    } catch (error) {
      if (session) await session.end().catch(() => {});
      session = null;
      if (enteredFullscreen && document.fullscreenElement)
        await document.exitFullscreen().catch(() => {});
      enteredFullscreen = false;
      enter.disabled = false;
      enter.textContent = "Try Enter VR again";
      report(error.message, true);
    }
  };

  window.orbitRoom = {
    version: 1,
    threeRevision: THREE.REVISION,
    frames: 0,
    xrFrames: 0,
    eyes: 0,
  };
  renderer.setAnimationLoop((time, frame) => {
    const delta =
      previous === null ? 0 : Math.min((time - previous) / 1000, 0.05);
    previous = time;
    if (!paused) elapsed += delta;
    core.rotation.set(elapsed * 0.2, elapsed * 0.35, 0);
    orbits.forEach((pivot, i) => {
      pivot.rotation.x = elapsed * (0.15 + i * 0.05) + i * 0.7;
      pivot.rotation.y = elapsed * (0.2 - i * 0.03) + i * 0.6;
    });
    objects.forEach((object, i) => {
      object.rotation.y = elapsed * (0.18 + i * 0.06);
      object.position.y = 1.15 + Math.sin(elapsed * 0.8 + i) * 0.08;
    });
    if (!renderer.xr.isPresenting) controls.update();
    renderer.render(scene, camera);
    window.orbitRoom.frames++;
    if (frame) {
      window.orbitRoom.xrFrames++;
      window.orbitRoom.eyes = renderer.xr.getCamera().cameras.length;
    }
  });
}
