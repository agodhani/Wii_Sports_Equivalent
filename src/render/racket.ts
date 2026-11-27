import * as THREE from 'three';

/** Shared oval frame and clipped string bed for held and pose-driven rackets. */
export function createRacketHead(color = 0xe8452f): THREE.Group {
  const head = new THREE.Group();
  head.name = 'racket-head';
  const frame = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.024, 6, 20),
    new THREE.MeshLambertMaterial({ color }));
  frame.scale.y = 1.25;
  head.add(frame);
  const points: number[] = [];
  const radius = 0.153;
  for (let i = -3; i <= 3; i++) {
    const offset = i * 0.038;
    const reach = Math.sqrt(radius * radius - offset * offset);
    points.push(offset, -reach * 1.25, 0, offset, reach * 1.25, 0);
    points.push(-reach, offset * 1.25, 0, reach, offset * 1.25, 0);
  }
  const strings = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)),
    new THREE.LineBasicMaterial({ color: 0xfff4df, transparent: true, opacity: 0.75 }),
  );
  strings.name = 'strings';
  head.add(strings);
  return head;
}
