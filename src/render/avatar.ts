import * as THREE from 'three';

/**
 * Wii-style chibi players: capsule body, big head with hair cap, dot eyes and
 * a smile on the `facing` side, stubby legs and a blob shadow. The group sits
 * on the ground (origin y = 0) and gameplay moves it in x only.
 */

export interface AvatarOpts {
  shirt: number;
  skin: number;
  hair: number;
  /** +1 faces +z (the CPU, so the camera sees its face); -1 faces -z (the player's back to the camera). */
  facing: 1 | -1;
  /** Attach a held racket on the avatar's right side, exposed as userData.swingPivot. */
  racket?: boolean;
}

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });

export function createAvatar(o: AvatarOpts): THREE.Group {
  const g = new THREE.Group();

  // stubby legs in dark shorts
  const legGeo = new THREE.CapsuleGeometry(0.09, 0.26, 3, 8);
  const shorts = lambert(0x3a3f4a);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, shorts);
    leg.position.set(0.13 * s, 0.3, 0);
    g.add(leg);
  }

  // body + head + hair
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.55, 4, 12), lambert(o.shirt));
  body.position.y = 0.75;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), lambert(o.skin));
  head.position.y = 1.55;
  g.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.215, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    lambert(o.hair),
  );
  hair.position.y = 1.58;
  g.add(hair);

  // face lives in its own group so flipping `facing` is one rotation
  const face = new THREE.Group();
  face.rotation.y = o.facing < 0 ? Math.PI : 0;
  const dark = new THREE.MeshBasicMaterial({ color: 0x141414 });
  const eyeGeo = new THREE.SphereGeometry(0.03, 8, 8);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, dark);
    eye.position.set(0.075 * s, 1.6, 0.175);
    face.add(eye);
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), dark);
  mouth.position.set(0, 1.53, 0.185);
  mouth.rotation.z = Math.PI; // bottom half-arc → ∪ smile
  face.add(mouth);
  g.add(face);

  // blob shadow — same depth trick as the ball's
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.024;
  g.add(shadow);

  if (o.racket) {
    // held on the avatar's right side — for the +z-facing CPU that's world -x
    const pivot = new THREE.Group();
    pivot.position.set(-0.36 * o.facing, 1.05, 0);
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.28, 3, 8), lambert(o.skin));
    forearm.position.set(0, -0.2, 0.05 * o.facing);
    forearm.rotation.x = -0.35 * o.facing;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.38, 8), lambert(0x2b2b2b));
    handle.position.set(0, -0.5, 0.12 * o.facing);
    handle.rotation.x = -0.3 * o.facing;
    const racketHead = new THREE.Mesh(
      new THREE.TorusGeometry(0.17, 0.028, 8, 20),
      lambert(0xe8452f),
    );
    racketHead.scale.set(1, 1.25, 1);
    racketHead.position.set(0, -0.68, 0.2 * o.facing);
    racketHead.rotation.x = -0.3 * o.facing;
    pivot.add(forearm, handle, racketHead);
    g.add(pivot);
    g.userData.swingPivot = pivot;
  }

  return g;
}
