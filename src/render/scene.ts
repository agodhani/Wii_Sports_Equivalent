import * as THREE from 'three';
import type { Vec3 } from '../types';

const COURT_HALF_W = 4.11;
const COURT_HALF_L = 11.9;

export class Scene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private ball: THREE.Mesh;
  private player: THREE.Mesh;
  private cpu: THREE.Mesh;
  private upperArm: THREE.Mesh;
  private forearm: THREE.Mesh;
  private racketHandle: THREE.Mesh;
  private racketHead: THREE.Mesh;
  private arm: THREE.Group;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.set(0, 5.5, 17);
    this.camera.lookAt(0, 0, -2);

    this.scene.background = new THREE.Color(0x1a2a4a);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(5, 12, 8);
    this.scene.add(sun);

    // court surface + surround
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 60),
      new THREE.MeshLambertMaterial({ color: 0x2e6b3a }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const court = new THREE.Mesh(
      new THREE.PlaneGeometry(COURT_HALF_W * 2, COURT_HALF_L * 2),
      new THREE.MeshLambertMaterial({ color: 0x3b7dd8 }),
    );
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.01;
    this.scene.add(court);

    // court lines (white strips)
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const line = (w: number, l: number, x: number, z: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, 0.02, z);
      this.scene.add(m);
    };
    line(0.08, COURT_HALF_L * 2, -COURT_HALF_W, 0); // sidelines
    line(0.08, COURT_HALF_L * 2, COURT_HALF_W, 0);
    line(COURT_HALF_W * 2, 0.08, 0, -COURT_HALF_L); // baselines
    line(COURT_HALF_W * 2, 0.08, 0, COURT_HALF_L);

    // net
    const net = new THREE.Mesh(
      new THREE.BoxGeometry(COURT_HALF_W * 2 + 0.8, 0.9, 0.05),
      new THREE.MeshLambertMaterial({ color: 0xdddddd, transparent: true, opacity: 0.75 }),
    );
    net.position.set(0, 0.45, 0);
    this.scene.add(net);

    // ball + avatars
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 16, 16),
      new THREE.MeshLambertMaterial({ color: 0xd8f542 }),
    );
    this.scene.add(this.ball);

    const avatar = (color: number) =>
      new THREE.Mesh(
        new THREE.CapsuleGeometry(0.3, 1.0, 4, 12),
        new THREE.MeshLambertMaterial({ color }),
      );
    this.player = avatar(0xe05555);
    this.player.position.set(0, 0.8, 11);
    this.cpu = avatar(0x5566e0);
    this.cpu.position.set(0, 0.8, -11);
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

  setBall(pos: Vec3): void { this.ball.position.set(pos.x, pos.y, pos.z); }
  setBallVisible(v: boolean): void { this.ball.visible = v; }
  setPlayerX(x: number): void { this.player.position.x = x; }
  setCpuX(x: number): void { this.cpu.position.x = x; }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(): void { this.renderer.render(this.scene, this.camera); }
}
