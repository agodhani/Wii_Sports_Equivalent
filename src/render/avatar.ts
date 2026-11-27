import * as THREE from 'three';
import { createRacketHead } from './racket';

export interface AvatarOpts {
  shirt: number;
  skin: number;
  hair: number;
  /** +1 faces +z (CPU); -1 faces -z (player). */
  facing: 1 | -1;
  racket?: boolean;
  style?: 'swept' | 'cropped';
}

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });

/** Articulated, procedural tennis player: no textures or downloaded assets. */
export class TennisAvatar extends THREE.Group {
  readonly swingPivot = new THREE.Group();
  private model = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private time = 0;
  private stride = 0;
  private speed = 0;
  private previousX = 0;
  private facing: 1 | -1;

  constructor(o: AvatarOpts) {
    super();
    this.facing = o.facing;
    this.name = 'tennis-avatar';
    this.model.name = 'outfit';
    this.model.rotation.y = o.facing < 0 ? Math.PI : 0;
    this.add(this.model);
    const shirt = lambert(o.shirt), skin = lambert(o.skin), hair = lambert(o.hair);
    const white = lambert(0xfff4df), navy = lambert(0x26324b), sole = lambert(0xd4dce6);
    const dark = lambert(0x222432);
    const sphere = new THREE.SphereGeometry(1, 12, 8);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const add = (parent: THREE.Object3D, name: string, geo: THREE.BufferGeometry,
      mat: THREE.Material, pos: number[], scale: number[]) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.position.set(pos[0], pos[1], pos[2]);
      mesh.scale.set(scale[0], scale[1], scale[2]);
      parent.add(mesh);
      return mesh;
    };

    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.name = side < 0 ? 'right-leg' : 'left-leg';
      leg.position.set(side * 0.14, 0.61, 0);
      add(leg, 'shorts-leg', box, navy, [0, -0.06, 0], [0.24, 0.22, 0.29]);
      add(leg, 'knee', sphere, skin, [0, -0.22, 0], [0.085, 0.13, 0.085]);
      add(leg, 'sock', box, white, [0, -0.38, 0], [0.14, 0.19, 0.15]);
      add(leg, 'sock-stripe', box, shirt, [0, -0.32, 0.078], [0.142, 0.025, 0.008]);
      add(leg, 'shoe-sole', box, sole, [0, -0.565, 0.055], [0.22, 0.055, 0.36]);
      add(leg, 'shoe', sphere, white, [0, -0.51, 0.05], [0.115, 0.08, 0.18]);
      add(leg, 'shoe-accent', box, shirt, [0, -0.485, 0.075], [0.16, 0.025, 0.06]);
      this.model.add(leg);
      this.legs.push(leg);
    }

    add(this.model, 'jersey', new THREE.CapsuleGeometry(0.25, 0.38, 4, 12), shirt,
      [0, 1.01, 0], [1, 1, 0.77]);
    add(this.model, 'waistband', box, white, [0, 0.66, 0], [0.48, 0.06, 0.32]);
    add(this.model, 'jersey-hem', box, navy, [0, 0.71, 0.176], [0.4, 0.035, 0.025]);
    add(this.model, 'neck', sphere, skin, [0, 1.4, 0], [0.09, 0.11, 0.09]);
    for (const side of [-1, 1]) {
      const collar = add(this.model, 'collar', box, white,
        [side * 0.075, 1.31, 0.14], [0.1, 0.11, 0.035]);
      collar.rotation.z = side * -0.45;
    }
    add(this.model, 'club-badge', sphere, white, [-0.13, 1.14, 0.177], [0.045, 0.055, 0.015]);
    add(this.model, 'badge-center', sphere, navy, [-0.13, 1.14, 0.19], [0.02, 0.025, 0.008]);
    add(this.model, 'back-stripe', box, white, [0, 1.07, -0.194], [0.065, 0.36, 0.012]);

    const head = new THREE.Group();
    head.name = 'head';
    head.position.y = 1.64;
    this.model.add(head);
    add(head, 'face', sphere, skin, [0, 0, 0], [0.245, 0.25, 0.225]);
    for (const side of [-1, 1]) {
      add(head, 'ear', sphere, skin, [side * 0.24, -0.015, 0], [0.05, 0.075, 0.045]);
      add(head, 'eye-white', sphere, white, [side * 0.085, 0.02, 0.209], [0.048, 0.059, 0.02]);
      add(head, 'eye', sphere, dark, [side * 0.08, 0.016, 0.229], [0.023, 0.036, 0.012]);
      add(head, 'eye-glint', sphere, white, [side * 0.08 - 0.007, 0.029, 0.24], [0.007, 0.009, 0.004]);
      const brow = add(head, 'eyebrow', box, hair,
        [side * 0.085, 0.104, 0.207], [0.077, 0.018, 0.025]);
      brow.rotation.z = side * -0.1;
    }
    add(head, 'nose', sphere, skin, [0, -0.028, 0.232], [0.035, 0.041, 0.04]);
    const smile = add(head, 'smile', new THREE.TorusGeometry(0.052, 0.009, 4, 12, Math.PI),
      dark, [0, -0.066, 0.211], [1, 0.65, 1]);
    smile.rotation.z = Math.PI;
    add(head, 'hair-cap', new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      hair, [0, 0.04, -0.015], [0.253, 0.24, 0.23]);
    if (o.style === 'cropped') {
      for (const side of [-1, 1]) {
        add(head, 'sideburn', box, hair, [side * 0.212, 0.03, 0.05], [0.045, 0.14, 0.12]);
      }
    } else {
      const fringe = add(head, 'swept-fringe', sphere, hair, [-0.055, 0.13, 0.17], [0.2, 0.09, 0.095]);
      fringe.rotation.z = -0.3;
    }
    const band = add(head, 'headband', new THREE.CylinderGeometry(0.268, 0.268, 0.055, 16),
      white, [0, 0.075, -0.01], [1, 1, 0.93]);
    add(band, 'headband-mark', box, shirt, [0, 0, 0.27], [0.075, 0.03, 0.01]);

    // Hide just the arm replaced by tracking, including its sleeve.
    for (const side of [-1, 1]) {
      const arm = side < 0 ? this.swingPivot : new THREE.Group();
      arm.name = side < 0 ? 'right-arm' : 'left-arm';
      arm.position.set(side * 0.28, 1.28, 0);
      add(arm, 'sleeve', sphere, shirt, [side * 0.025, -0.055, 0], [0.12, 0.15, 0.13]);
      add(arm, 'arm', new THREE.CapsuleGeometry(0.06, 0.22, 3, 8), skin,
        [side * 0.035, -0.27, 0.035], [1, 1, 1]);
      add(arm, 'wristband', box, white, [side * 0.035, -0.38, 0.035], [0.13, 0.065, 0.13]);
      add(arm, 'hand', sphere, skin, [side * 0.035, -0.45, 0.04], [0.07, 0.08, 0.065]);
      if (side < 0 && o.racket) {
        const racket = new THREE.Group();
        racket.name = 'held-racket';
        racket.position.set(-0.035, -0.46, 0.04);
        racket.rotation.x = -0.25;
        add(racket, 'grip', new THREE.CylinderGeometry(0.025, 0.025, 0.32, 8), navy,
          [0, -0.12, 0], [1, 1, 1]);
        const racketHead = createRacketHead(o.shirt);
        racketHead.position.y = -0.48;
        racket.add(racketHead);
        arm.add(racket);
      }
      this.model.add(arm);
      this.arms.push(arm);
    }
    this.userData.swingPivot = this.swingPivot;
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.43, 20),
      new THREE.MeshBasicMaterial({ color: 0x15243b, transparent: true, opacity: 0.26, depthWrite: false }));
    shadow.name = 'shadow';
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.024;
    this.add(shadow);
  }

  /** Court-space side of the tracked arm, or null for both at rest. */
  setTrackedArm(side: -1 | 1 | null): void {
    this.arms[0].visible = side !== -this.facing;
    this.arms[1].visible = side !== this.facing;
  }

  /** Cosmetic only: never moves the court-space origin or hit target. */
  animate(dt: number): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const step = Math.min(dt, 0.1);
    const velocity = THREE.MathUtils.clamp((this.position.x - this.previousX) / dt, -8, 8);
    this.previousX = this.position.x;
    this.speed = THREE.MathUtils.lerp(this.speed, velocity, 1 - Math.exp(-12 * step));
    this.time += step;
    const run = Math.min(1, Math.abs(this.speed) / 3);
    this.stride += step * (8 + 7 * run);
    const swing = Math.sin(this.stride) * 0.42 * run;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.model.position.y = Math.sin(this.time * 2.5) * 0.007 + Math.abs(Math.sin(this.stride)) * 0.035 * run;
    this.model.rotation.z = -this.speed * this.facing * 0.018;
    this.arms[1].rotation.x = -swing * 0.65;
  }
}

export function createAvatar(o: AvatarOpts): TennisAvatar {
  return new TennisAvatar(o);
}
