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

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

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
