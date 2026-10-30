import * as THREE from 'three';
import type { Vec3 } from '../types';
import type { CuePhase } from '../game/timing';
import { buildWorld, type Crowd } from './world';
import { createAvatar } from './avatar';
import { fitCamera } from './framing';

// Blob shadow under the ball: a depth cue for the player's camera without
// paying for shadow maps. It shrinks and fades as the ball climbs.
const SHADOW_Y = 0.025; // just above the court lines (0.02) to avoid z-fighting
const SHADOW_RADIUS = 0.16;
const SHADOW_MAX_OPACITY = 0.45;
const SHADOW_FALLOFF = 0.3; // per metre of ball height

const TRAIL_N = 12;
const TRAIL_COOL = new THREE.Color(0xd8f542); // matches the ball
const TRAIL_HOT = new THREE.Color(0xff8a3d);
const BURST_LIFE_S = 0.45;
const CUE_POP_S = 0.25;

interface Burst {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  vel: Float32Array;
  life: number;
}

export class Scene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private ball: THREE.Mesh;
  private ballShadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private player: THREE.Group;
  private cpu: THREE.Group;
  private cpuPivot: THREE.Group | null = null;
  private cpuSwingT: number | null = null; // seconds into the CPU's swing, null = at rest
  private crowd: Crowd;
  private upperArm: THREE.Mesh;
  private forearm: THREE.Mesh;
  private racketHandle: THREE.Mesh;
  private racketHead: THREE.Mesh;
  private arm: THREE.Group;
  // Screen shake: the camera renders at cameraBase + a random offset scaled by
  // trauma², so a hit jolts the frame without fighting the attract-mode orbit.
  private cameraBase = new THREE.Vector3(0, 5.5, 17);
  private playBase = new THREE.Vector3(0, 5.5, 17); // gameplay framing from fitCamera
  private trauma = 0;
  private cue = new THREE.Group();
  private cueInner: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private cueOuter: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private cuePop: { t: number } | null = null;
  private trail: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>[] = [];
  private trailHist: Vec3[] = []; // newest first
  private trailPower = 0;
  private bursts: Burst[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    // Cap pixel ratio: retina-class displays would otherwise render at 2×
    // (4× the fragment work) for a barely visible difference.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
    this.camera.position.set(0, 5.5, 17);
    this.camera.lookAt(0, 0, -2);

    // sky, lighting, grass, court, lines, net, stands + crowd — all procedural
    this.crowd = buildWorld(this.scene).crowd;

    // ball + avatars
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 16, 16),
      new THREE.MeshLambertMaterial({ color: 0xd8f542 }),
    );
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(
      new THREE.CircleGeometry(SHADOW_RADIUS, 20),
      new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: SHADOW_MAX_OPACITY, depthWrite: false,
      }),
    );
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.position.y = SHADOW_Y;
    this.scene.add(this.ballShadow);

    this.player = createAvatar({ shirt: 0xe05555, skin: 0xf0c9a0, hair: 0x3a2a1a, facing: -1 });
    this.player.position.set(0, 0, 11);
    this.cpu = createAvatar({
      shirt: 0x5566e0,
      skin: 0xc98d5e,
      hair: 0x1c1c22,
      facing: 1,
      racket: true,
    });
    this.cpu.position.set(0, 0, -11);
    this.cpuPivot = this.cpu.userData.swingPivot ?? null;
    this.scene.add(this.player, this.cpu);

    // Playing arm and racket, driven by the player's tracked pose. Each segment
    // is a unit-length cylinder along +Y, then positioned/oriented/stretched per
    // frame by segment(), so the whole limb is three cheap transforms.
    const limbMat = new THREE.MeshLambertMaterial({ color: 0xf0c9a0 });
    const unitLimb = (radius: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 10), limbMat);
      m.geometry.translate(0, 0.5, 0); // pivot at the base so scale.y grows toward +Y
      return m;
    };
    this.upperArm = unitLimb(0.075);
    this.forearm = unitLimb(0.06);
    this.racketHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 1, 8),
      new THREE.MeshLambertMaterial({ color: 0x2b2b2b }),
    );
    this.racketHandle.geometry.translate(0, 0.5, 0);
    this.racketHead = new THREE.Mesh(
      new THREE.TorusGeometry(0.17, 0.028, 8, 20),
      new THREE.MeshLambertMaterial({ color: 0xe8452f }),
    );
    this.racketHead.scale.set(1, 1.25, 1); // oval, long side along the forearm
    this.arm = new THREE.Group();
    this.arm.add(this.upperArm, this.forearm, this.racketHandle, this.racketHead);
    this.arm.visible = false;
    this.scene.add(this.arm);

    // Timing reticle: two flat rings facing the camera at the contact point.
    // The outer ring shrinks onto the inner one as the ball arrives; both sit
    // on top of everything (depthTest off) since the avatar stands in front.
    const cueMat = (opacity: number) =>
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity,
        depthTest: false,
        depthWrite: false,
      });
    this.cueInner = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.24, 40), cueMat(0.9));
    this.cueOuter = new THREE.Mesh(new THREE.RingGeometry(0.93, 1.0, 48), cueMat(0.35));
    this.cueInner.renderOrder = 10;
    this.cueOuter.renderOrder = 10;
    this.cue.add(this.cueInner, this.cueOuter);
    this.cue.visible = false;
    this.scene.add(this.cue);

    // Ball trail: a fading tail of spheres replaying the last few positions —
    // the cheapest way to make a small fast ball readable.
    const trailGeo = new THREE.SphereGeometry(0.11, 10, 10);
    for (let i = 0; i < TRAIL_N; i++) {
      const m = new THREE.Mesh(
        trailGeo,
        new THREE.MeshBasicMaterial({
          color: TRAIL_COOL.clone(),
          transparent: true,
          opacity: 0.35 * (1 - i / TRAIL_N),
          depthWrite: false,
        }),
      );
      m.scale.setScalar((1 - i / TRAIL_N) * 0.9);
      m.visible = false;
      this.trail.push(m);
      this.scene.add(m);
    }

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Point a unit-length +Y segment mesh from `a` to `b`. */
  private static segment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    mesh.position.copy(a);
    if (len > 1e-6) {
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().divideScalar(len));
    }
    mesh.scale.set(1, len, 1);
  }

  /**
   * Place the playing arm. Positions are court-space; the racket extends past
   * the wrist along the forearm, so it swings where the real forearm points.
   */
  setArm(shoulder: Vec3, elbow: Vec3, wrist: Vec3): void {
    this.arm.visible = true;
    const s = new THREE.Vector3(shoulder.x, shoulder.y, shoulder.z);
    const e = new THREE.Vector3(elbow.x, elbow.y, elbow.z);
    const w = new THREE.Vector3(wrist.x, wrist.y, wrist.z);
    Scene.segment(this.upperArm, s, e);
    Scene.segment(this.forearm, e, w);

    const forearmDir = new THREE.Vector3().subVectors(w, e);
    if (forearmDir.lengthSq() < 1e-9) forearmDir.set(0, -1, 0);
    forearmDir.normalize();
    const handleEnd = w.clone().addScaledVector(forearmDir, 0.34);
    Scene.segment(this.racketHandle, w, handleEnd);
    this.racketHead.position.copy(handleEnd.clone().addScaledVector(forearmDir, 0.17));
    // The head's ring lies in the court XY plane, so its face points down the
    // court and reads face-on from the camera behind the player. Spinning it
    // about that axis keeps the oval's long side along the forearm, which is
    // what makes the racket's tilt visibly follow the arm.
    this.racketHead.rotation.set(0, 0, Math.atan2(forearmDir.y, forearmDir.x) - Math.PI / 2);
  }

  setArmVisible(v: boolean): void { this.arm.visible = v; }

  /**
   * Attract-mode camera: pass a time to orbit slowly around the court behind
   * the home screen, or null to restore the gameplay framing exactly. Writes
   * the shake-free base position — render() adds the trauma offset on top so
   * the two compose.
   */
  setAttractCamera(t: number | null): void {
    if (t === null) {
      this.cameraBase.copy(this.playBase);
    } else {
      // orbit radius/height scale with the fitted play position so the same
      // cinematic works in portrait
      const k = (this.playBase.z + 2) / 19;
      const h = this.playBase.y / 5.5;
      this.cameraBase.set(Math.sin(t * 0.15) * 6 * k, 6.5 * h, Math.cos(t * 0.15) * 17 * k);
    }
  }

  /**
   * Timing reticle at the incoming ball's contact point. The outer ring
   * shrinks from wide-open to the inner ring's size as `closeness` goes 0 → 1,
   * turning green inside the hit window and red once it has passed.
   */
  setTimingCue(cue: { pos: Vec3; closeness: number; phase: CuePhase } | null): void {
    if (!cue) {
      if (!this.cuePop) this.cue.visible = false; // let a contact pop finish
      return;
    }
    this.cuePop = null; // a fresh cue cancels any running pop
    this.cue.visible = true;
    this.cue.scale.setScalar(1);
    this.cue.position.set(cue.pos.x, cue.pos.y, cue.pos.z);
    this.cueOuter.scale.setScalar(1 - 0.78 * cue.closeness);
    const inner = this.cueInner.material;
    const outer = this.cueOuter.material;
    if (cue.phase === 'window') {
      inner.color.set(0x5ce65c);
      outer.color.set(0x5ce65c);
      inner.opacity = 0.95;
      outer.opacity = 0.95;
    } else if (cue.phase === 'late') {
      inner.color.set(0xff5a5a);
      outer.color.set(0xff5a5a);
      inner.opacity = 0.8;
      outer.opacity = 0.8;
    } else {
      inner.color.set(0xffffff);
      outer.color.set(0xffffff);
      inner.opacity = 0.9;
      outer.opacity = 0.35 + 0.4 * cue.closeness;
    }
  }

  /** Contact celebration: the reticle pops outward and fades, gold on a perfect. */
  popTimingCue(perfect: boolean): void {
    this.cuePop = { t: 0 };
    this.cue.visible = true;
    this.cue.scale.setScalar(1);
    const color = perfect ? 0xffd23f : 0x5ce65c;
    this.cueInner.material.color.set(color);
    this.cueOuter.material.color.set(color);
    this.cueInner.material.opacity = 0.95;
    this.cueOuter.material.opacity = 0.95;
  }

  /** Trail color: cool ball-yellow at rest, hot orange after a hard hit. */
  setTrailHot(power: number): void {
    this.trailPower = Math.min(1, Math.max(0, power));
    const color = TRAIL_COOL.clone().lerp(TRAIL_HOT, this.trailPower);
    for (const m of this.trail) m.material.color.copy(color);
  }

  /** Spawn a short-lived particle burst — impact juice for hits and bounces. */
  burst(pos: Vec3, power: number, color = 0xffffff): void {
    const p = Math.min(1, Math.max(0, power));
    const count = Math.round(8 + 22 * p);
    const positions = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      // random direction in the upward hemisphere-ish, scaled by hit power
      const theta = Math.random() * Math.PI * 2;
      const vy = Math.random();
      const rh = Math.sqrt(Math.max(0, 1 - vy * vy));
      const speed = (2 + 3 * Math.random()) * (0.6 + p);
      vel[i * 3] = Math.cos(theta) * rh * speed;
      vel[i * 3 + 1] = vy * speed;
      vel[i * 3 + 2] = Math.sin(theta) * rh * speed;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.07,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, vel, life: BURST_LIFE_S });
  }

  /** Add screen shake; bigger hits keep the bigger of the two traumas. */
  shake(amount: number): void {
    this.trauma = Math.max(this.trauma, Math.min(1, Math.max(0, amount)));
  }

  /** Crowd celebration — bigger intensity for points the player won. */
  cheer(intensity: number): void {
    this.crowd.cheer(intensity);
  }

  /** Trigger the CPU's racket swing (call when it strikes the ball). */
  cpuSwing(): void {
    if (this.cpuPivot) this.cpuSwingT = 0;
  }

  /**
   * Advance real-time effects: reticle pop, particle bursts, shake decay.
   * Driven with the unclamped frame dt so juice keeps playing during hit-stop.
   */
  update(dt: number): void {
    if (this.cuePop) {
      this.cuePop.t += dt;
      const k = Math.min(1, this.cuePop.t / CUE_POP_S);
      this.cue.scale.setScalar(1 + 0.6 * k);
      const o = 0.95 * (1 - k);
      this.cueInner.material.opacity = o;
      this.cueOuter.material.opacity = o;
      if (k >= 1) {
        this.cuePop = null;
        this.cue.visible = false;
        this.cue.scale.setScalar(1);
      }
    }
    this.trauma = Math.max(0, this.trauma - 2.5 * dt);
    this.crowd.update(dt);
    if (this.cpuSwingT !== null && this.cpuPivot) {
      // 0.3 s swing: sweep the pivot −120° → +60° (ease-out) then back to rest
      this.cpuSwingT += dt;
      const k = this.cpuSwingT / 0.3;
      if (k >= 1) {
        this.cpuPivot.rotation.y = 0;
        this.cpuSwingT = null;
      } else {
        const a =
          k < 0.6
            ? -120 + 180 * (1 - Math.pow(1 - k / 0.6, 2))
            : 60 * (1 - (k - 0.6) / 0.4);
        this.cpuPivot.rotation.y = (a * Math.PI) / 180;
      }
    }
    const live: Burst[] = [];
    for (const b of this.bursts) {
      b.life -= dt;
      if (b.life <= 0) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        b.points.material.dispose();
        continue;
      }
      const attr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let i = 0; i < attr.count; i++) {
        b.vel[i * 3 + 1] += -9.8 * dt;
        arr[i * 3] += b.vel[i * 3] * dt;
        arr[i * 3 + 1] += b.vel[i * 3 + 1] * dt;
        arr[i * 3 + 2] += b.vel[i * 3 + 2] * dt;
      }
      attr.needsUpdate = true;
      b.points.material.opacity = b.life / BURST_LIFE_S;
      live.push(b);
    }
    this.bursts = live;
  }

  setBall(pos: Vec3): void {
    this.ball.position.set(pos.x, pos.y, pos.z);
    // Higher ball -> smaller, fainter shadow; k is 1 at the ground.
    const k = 1 / (1 + Math.max(0, pos.y) * SHADOW_FALLOFF);
    this.ballShadow.position.set(pos.x, SHADOW_Y, pos.z);
    this.ballShadow.scale.setScalar(0.5 + 0.5 * k);
    this.ballShadow.material.opacity = SHADOW_MAX_OPACITY * k;

    this.trailHist.unshift({ ...pos });
    if (this.trailHist.length > TRAIL_N) this.trailHist.pop();
    for (let i = 0; i < TRAIL_N; i++) {
      const m = this.trail[i];
      const p = this.trailHist[i];
      m.visible = !!p;
      if (p) m.position.set(p.x, p.y, p.z);
    }
  }
  setBallVisible(v: boolean): void {
    this.ball.visible = v;
    this.ballShadow.visible = v;
    if (!v) {
      this.trailHist = [];
      for (const m of this.trail) m.visible = false;
    }
  }
  setPlayerX(x: number): void { this.player.position.x = x; }
  setCpuX(x: number): void { this.cpu.position.x = x; }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    // Portrait phones get a wider FOV and a pulled-back camera so the court
    // still fits; desktop keeps the classic framing.
    const f = fitCamera(w / h);
    this.camera.fov = f.fov;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.playBase.set(f.pos.x, f.pos.y, f.pos.z);
    this.cameraBase.copy(this.playBase);
  }

  render(): void {
    this.camera.position.copy(this.cameraBase);
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma * 0.25;
      this.camera.position.x += s * (Math.random() * 2 - 1);
      this.camera.position.y += s * (Math.random() * 2 - 1);
    }
    this.camera.lookAt(0, 0, -2);
    this.renderer.render(this.scene, this.camera);
  }
}
