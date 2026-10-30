import * as THREE from 'three';

/**
 * The static stadium: sky, lighting, grass, court + lines, net, stands and the
 * crowd. Everything is procedural — CanvasTextures painted at boot, like the
 * synthesized sfx — so there are no asset files to ship. Called once from the
 * Scene constructor; the only living part is the crowd (cheer/idle sway).
 */

const COURT_HALF_W = 4.11;
const COURT_HALF_L = 11.9;
const SERVICE_Z = 6.4;

export interface Crowd {
  /** Spectators jump for ~1.6s; intensity scales the hop height. */
  cheer(intensity: number): void;
  update(dt: number): void;
}

/** Paint a small canvas into a CanvasTexture marked as sRGB color data. */
function canvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Base color with fine per-pixel grain, tiled — keeps big surfaces from reading
 * flat without visible blocks (mipmapping averages it into a subtle texture).
 */
function noiseTexture(hex: string, jitter = 0.06, size = 256): THREE.CanvasTexture {
  const t = canvasTexture(size, size, (ctx) => {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, size, size);
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const k = 1 + (Math.random() - 0.5) * 2 * jitter;
      img.data[i] = Math.min(255, img.data[i] * k);
      img.data[i + 1] = Math.min(255, img.data[i + 1] * k);
      img.data[i + 2] = Math.min(255, img.data[i + 2] * k);
    }
    ctx.putImageData(img, 0, 0);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });

/** Ground-plane mesh (rotated flat, raised off y=0 to avoid z-fighting). */
function plane(
  w: number,
  l: number,
  mat: THREE.Material,
  y: number,
  x = 0,
  z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

export function buildWorld(scene: THREE.Scene): { crowd: Crowd } {
  // ---- sky gradient + haze ----
  scene.background = canvasTexture(4, 512, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#3d8fe0');
    g.addColorStop(1, '#cfe9ff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 512);
  });
  scene.fog = new THREE.Fog(0xcfe9ff, 35, 90);

  // ---- lighting: sky bounce + warm sun ----
  scene.add(new THREE.HemisphereLight(0xdff1ff, 0x4a7a3a, 0.9));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.4);
  sun.position.set(5, 12, 8);
  scene.add(sun);

  // ---- grass with mowing stripes (2 m bands running down the court length) ----
  const grassTex = canvasTexture(64, 64, (ctx) => {
    ctx.fillStyle = '#3f8f3f';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#4a9b47';
    ctx.fillRect(32, 0, 32, 64);
  });
  grassTex.wrapS = THREE.RepeatWrapping;
  grassTex.repeat.set(15, 1); // 60 m / (2 bands × 2 m)
  const grass = plane(60, 90, new THREE.MeshLambertMaterial({ map: grassTex }), 0);
  scene.add(grass);

  // ---- hard-court apron, then the court itself ----
  scene.add(plane(18, 36, lambert(0x3f7f6a), 0.005));
  const courtTex = noiseTexture('#3b7dd8');
  courtTex.repeat.set(4, 12); // ~2 m tiles, so the grain is square, not stretched
  const court = plane(
    COURT_HALF_W * 2,
    COURT_HALF_L * 2,
    new THREE.MeshLambertMaterial({ map: courtTex }),
    0.01,
  );
  scene.add(court);

  // ---- court lines (white strips) ----
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const line = (w: number, l: number, x: number, z: number) =>
    scene.add(plane(w, l, lineMat, 0.02, x, z));
  line(0.08, COURT_HALF_L * 2, -COURT_HALF_W, 0); // singles sidelines
  line(0.08, COURT_HALF_L * 2, COURT_HALF_W, 0);
  line(COURT_HALF_W * 2, 0.08, 0, -COURT_HALF_L); // baselines
  line(COURT_HALF_W * 2, 0.08, 0, COURT_HALF_L);
  line(COURT_HALF_W * 2, 0.06, 0, -SERVICE_Z); // service lines
  line(COURT_HALF_W * 2, 0.06, 0, SERVICE_Z);
  line(0.06, SERVICE_Z * 2, 0, 0); // center service line
  line(0.08, 0.3, 0, -COURT_HALF_L + 0.15); // center marks, drawn into the court
  line(0.08, 0.3, 0, COURT_HALF_L - 0.15);

  // ---- net: posts, string-mesh body (alpha-tested diamonds), white tape ----
  const postX = COURT_HALF_W + 0.9;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.07, 10), lambert(0x3a4a42));
    post.position.set(postX * side, 1.07 / 2, 0);
    scene.add(post);
  }
  const netTex = canvasTexture(64, 64, (ctx) => {
    ctx.strokeStyle = 'rgba(22,25,32,0.95)';
    ctx.lineWidth = 2;
    for (let i = -64; i <= 128; i += 12) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 64, 64); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, 64); ctx.lineTo(i + 64, 0); ctx.stroke();
    }
  });
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping;
  netTex.repeat.set(6, 1);
  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(postX * 2, 0.86),
    new THREE.MeshBasicMaterial({
      map: netTex,
      transparent: true,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
    }),
  );
  net.position.set(0, 0.49, 0);
  scene.add(net);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(postX * 2 + 0.06, 0.06, 0.06), lambert(0xf5f5f5));
  tape.position.set(0, 0.95, 0);
  scene.add(tape);

  // ---- stepped bleachers: both sidelines + behind the CPU baseline ----
  const TIERS = 4; // each tier +0.5 m up, 0.9 m deep
  const standMat = lambert(0x7e8ba0);
  const spots: { x: number; y: number; z: number }[] = [];
  const GAP = 0.15; // ~15% empty seats
  // Build the tier boxes and the spectator spots that sit on their tops.
  // Side stands: |x| from ~9.5 stepping away from the court, spanning z −16..16.
  for (const side of [-1, 1]) {
    for (let i = 0; i < TIERS; i++) {
      const h = 0.5 * (i + 1);
      const cx = side * (9.5 + 0.9 * i + 0.45);
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 32), standMat);
      step.position.set(cx, h / 2, 0);
      scene.add(step);
      for (let z = -15.6; z <= 15.6; z += 0.7) {
        if (Math.random() < GAP) continue;
        spots.push({ x: cx + (Math.random() - 0.5) * 0.2, y: h, z });
      }
    }
  }
  // Back stand behind the CPU baseline at z ≈ −19, spanning x −12..12.
  for (let i = 0; i < TIERS; i++) {
    const h = 0.5 * (i + 1);
    const cz = -(19 + 0.9 * i + 0.45);
    const step = new THREE.Mesh(new THREE.BoxGeometry(24, h, 0.9), standMat);
    step.position.set(0, h / 2, cz);
    scene.add(step);
    for (let x = -11.6; x <= 11.6; x += 0.7) {
      if (Math.random() < GAP) continue;
      spots.push({ x, y: h, z: cz + (Math.random() - 0.5) * 0.2 });
    }
  }

  return { crowd: new CrowdImpl(scene, spots) };
}

const SHIRTS = [0xe14d4d, 0x4d6be1, 0xffd23f, 0x42c95c, 0xff8a3d, 0xf0f0f0, 0x9b59e0, 0x3fb6d8];
const SKINS = [0xf0c9a0, 0xc98d5e, 0x8d5524, 0x6b3f1d, 0xffdbac];
const CHEER_S = 1.6;

class CrowdImpl implements Crowd {
  private bodies: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private baseY: Float32Array;
  private phase: Float32Array;
  private t = 0;
  private cheerLeft = 0;
  private cheerAmp = 0;

  constructor(scene: THREE.Scene, spots: { x: number; y: number; z: number }[]) {
    const n = spots.length;
    this.bodies = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(0.15, 0.32, 2, 8),
      new THREE.MeshLambertMaterial(),
      n,
    );
    this.heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.1, 8, 8),
      new THREE.MeshLambertMaterial(),
      n,
    );
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    this.baseY = new Float32Array(n);
    this.phase = new Float32Array(n);
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    spots.forEach((s, i) => {
      m.setPosition(s.x, s.y + 0.38, s.z);
      this.bodies.setMatrixAt(i, m);
      m.setPosition(s.x, s.y + 0.7, s.z);
      this.heads.setMatrixAt(i, m);
      this.bodies.setColorAt(i, col.setHex(SHIRTS[(Math.random() * SHIRTS.length) | 0]));
      this.heads.setColorAt(i, col.setHex(SKINS[(Math.random() * SKINS.length) | 0]));
      this.baseY[i] = s.y;
      this.phase[i] = Math.random() * Math.PI * 2;
    });
    scene.add(this.bodies, this.heads);
  }

  cheer(intensity: number): void {
    this.cheerLeft = CHEER_S;
    this.cheerAmp = Math.min(1, Math.max(0, intensity));
  }

  update(dt: number): void {
    this.t += dt;
    this.cheerLeft = Math.max(0, this.cheerLeft - dt);
    const jumping = this.cheerLeft > 0;
    const decay = this.cheerLeft / CHEER_S;
    // Translations only — spectators never rotate, so we can write the y
    // element of each instance matrix directly instead of recomposing 4x4s.
    const bm = this.bodies.instanceMatrix.array as Float32Array;
    const hm = this.heads.instanceMatrix.array as Float32Array;
    for (let i = 0; i < this.baseY.length; i++) {
      const ph = this.phase[i];
      const dy = jumping
        ? this.cheerAmp * 0.35 * Math.abs(Math.sin(ph + this.t * 12)) * decay
        : 0.02 * Math.sin(ph + this.t * 2.2); // idle sway
      bm[i * 16 + 13] = this.baseY[i] + 0.38 + dy;
      hm[i * 16 + 13] = this.baseY[i] + 0.7 + dy;
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}
