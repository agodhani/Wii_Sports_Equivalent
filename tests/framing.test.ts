import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { fitCamera } from '../src/render/framing';

const POINTS = [
  [4.8, 0, 11],
  [-4.8, 0, 11],
  [4.8, 1.2, 9.8],
  [-4.8, 1.2, 9.8],
  [4.11, 0, -11.9],
  [-4.11, 0, -11.9],
  [0, 1.6, -11],
];

function project(aspect: number) {
  const f = fitCamera(aspect);
  const cam = new PerspectiveCamera(f.fov, aspect, 0.1, 200);
  cam.position.set(f.pos.x, f.pos.y, f.pos.z);
  cam.lookAt(0, 0, -2);
  cam.updateMatrixWorld();
  return { f, ndc: POINTS.map((p) => new Vector3(...(p as [number, number, number])).project(cam)) };
}

describe('fitCamera', () => {
  it('returns the exact desktop framing at aspect >= 1.2', () => {
    expect(fitCamera(1.6)).toEqual({ fov: 55, pos: { x: 0, y: 5.5, z: 17 } });
    expect(fitCamera(1.2)).toEqual({ fov: 55, pos: { x: 0, y: 5.5, z: 17 } });
  });

  it('keeps every required point inside NDC on narrow aspects', () => {
    // NB: 1.2 is deliberately absent — the exact desktop framing it must
    // return puts the (±4.8, 0, 11) corner points just outside |x|=0.97
    // (as it always has on desktop); the correction only exists below 1.2.
    for (const aspect of [0.46, 0.6, 0.75, 1.0]) {
      const { f, ndc } = project(aspect);
      expect(f.fov).toBeLessThanOrEqual(75);
      for (const v of ndc) {
        expect(Math.abs(v.x), `aspect ${aspect} x at z=${v.z}`).toBeLessThanOrEqual(0.97);
        expect(Math.abs(v.y), `aspect ${aspect} y`).toBeLessThanOrEqual(0.97);
      }
    }
  });

  it('is continuous across the 1.2 boundary', () => {
    const a = fitCamera(1.19);
    const b = fitCamera(1.21);
    expect(Math.abs(a.fov - b.fov)).toBeLessThan(1);
    const d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
    expect(d).toBeLessThan(0.3);
  });
});
