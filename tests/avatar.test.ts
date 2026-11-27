import { describe, expect, it } from 'vitest';
import { Box3, LineSegments, Vector3 } from 'three';
import { createAvatar } from '../src/render/avatar';
import { createRacketHead } from '../src/render/racket';

const outfit = { shirt: 0xe05555, skin: 0xf0c9a0, hair: 0x3a2a1a };

describe('tennis avatar rig', () => {
  it.each([1, -1] as const)('faces the court and keeps its shoes on the ground (%s)', (facing) => {
    const avatar = createAvatar({ ...outfit, facing });
    avatar.updateMatrixWorld(true);
    const nose = avatar.getObjectByName('nose')!.getWorldPosition(new Vector3());
    expect(Math.sign(nose.z)).toBe(facing);
    const bounds = new Box3().setFromObject(avatar);
    expect(bounds.min.y).toBeGreaterThanOrEqual(0);
    expect(bounds.max.y).toBeLessThan(2);
  });

  it.each([1, -1] as const)('replaces only the tracked court-side arm (%s)', (facing) => {
    const avatar = createAvatar({ ...outfit, facing });
    for (const side of [-1, 1] as const) {
      avatar.setTrackedArm(side);
      avatar.updateMatrixWorld(true);
      const arms = ['right-arm', 'left-arm'].map((name) => avatar.getObjectByName(name)!);
      expect(arms.filter((arm) => arm.visible)).toHaveLength(1);
      const hidden = arms.find((arm) => !arm.visible)!;
      expect(Math.sign(hidden.getWorldPosition(new Vector3()).x)).toBe(side);
    }
    avatar.setTrackedArm(null);
    expect(avatar.getObjectByName('right-arm')!.visible).toBe(true);
    expect(avatar.getObjectByName('left-arm')!.visible).toBe(true);
  });

  it('runs opposing legs, settles at rest, and never changes game coordinates or CPU swing', () => {
    const avatar = createAvatar({ ...outfit, facing: 1, racket: true });
    avatar.position.z = -11;
    avatar.swingPivot.rotation.y = 0.8;
    for (let i = 0; i < 20; i++) {
      avatar.position.x += 0.05;
      avatar.animate(1 / 60);
    }
    const right = avatar.getObjectByName('right-leg')!;
    const left = avatar.getObjectByName('left-leg')!;
    expect(Math.abs(right.rotation.x)).toBeGreaterThan(0.01);
    expect(left.rotation.x).toBe(-right.rotation.x);
    expect(avatar.position.toArray()).toEqual([expect.closeTo(1), 0, -11]);
    expect(avatar.swingPivot.rotation.y).toBe(0.8);
    for (let i = 0; i < 120; i++) avatar.animate(1 / 60);
    expect(Math.abs(right.rotation.x)).toBeLessThan(0.001);
    expect(avatar.getObjectByName('held-racket')!.parent).toBe(avatar.swingPivot);
  });

  it('handles paused frames and a long tab suspension without invalid transforms', () => {
    const avatar = createAvatar({ ...outfit, facing: -1 });
    for (const dt of [0, -1, NaN, Infinity, 60, 1 / 60]) avatar.animate(dt);
    avatar.traverse((node) => {
      expect([...node.position.toArray(), ...node.quaternion.toArray()].every(Number.isFinite)).toBe(true);
    });
  });
});

it('clips every racket string to the inside of the oval frame', () => {
  const head = createRacketHead();
  const strings = head.getObjectByName('strings') as LineSegments;
  const vertices = strings.geometry.getAttribute('position');
  expect(vertices.count).toBeGreaterThan(0);
  for (let i = 0; i < vertices.count; i++) {
    expect(Math.hypot(vertices.getX(i), vertices.getY(i) / 1.25)).toBeCloseTo(0.153, 5);
  }
});
