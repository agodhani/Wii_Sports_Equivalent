/**
 * Aspect-aware camera framing. The camera always sits on the ray
 * LOOK + s·AXIS (the desktop position at s=1) and looks at LOOK, so fitting a
 * narrow viewport is purely a question of how far to pull back along that ray
 * and how much to widen the FOV. Wide screens (aspect ≥ 1.2) keep the exact
 * desktop framing; portrait phones get a wider FOV and a pulled-back camera so
 * the sidelines, the timing reticle and the CPU stay on screen.
 *
 * Both corrections ramp in over aspect 1.2 → 1.0 through a smoothstep, so the
 * framing changes continuously with no jump at the boundary.
 */

export interface Framing {
  fov: number;
  pos: { x: number; y: number; z: number };
} // camera looks at (0, 0, -2)

const LOOK = { x: 0, y: 0, z: -2 };
const AXIS = { y: 5.5, z: 19 }; // unit-less ray: cam = LOOK + s·AXIS, s=1 → desktop
const AXIS_LEN = Math.hypot(AXIS.y, AXIS.z); // distance per unit of pull-back s
// View basis: forward points down the ray, up is perpendicular in the YZ
// plane (the camera has no x offset, so view-right is always world +x).
const F = { y: -AXIS.y / AXIS_LEN, z: -AXIS.z / AXIS_LEN };
const U = { y: -F.z, z: F.y };

const NDC_LIMIT = 0.97;
const FOV_DESKTOP = 55;
const FOV_MAX = 75;

// Everything that must stay on screen: court corners, the reticle's extremes,
// and the CPU's head.
const POINTS = [
  { x: 4.8, y: 0, z: 11 },
  { x: -4.8, y: 0, z: 11 },
  { x: 4.8, y: 1.2, z: 9.8 },
  { x: -4.8, y: 1.2, z: 9.8 },
  { x: 4.11, y: 0, z: -11.9 },
  { x: -4.11, y: 0, z: -11.9 },
  { x: 0, y: 1.6, z: -11 },
];

const smoothstep = (t: number) => t * t * (3 - 2 * t);

export function fitCamera(aspect: number): Framing {
  if (aspect >= 1.2) {
    return { fov: FOV_DESKTOP, pos: { x: 0, y: AXIS.y, z: LOOK.z + AXIS.z } };
  }
  // Correction strength: 0 at aspect 1.2, ramps smoothly to 1 at aspect 1.0.
  const g = smoothstep(Math.min(1, (1.2 - aspect) / 0.2));
  const fov = FOV_DESKTOP + (FOV_MAX - FOV_DESKTOP) * g;
  const tan = Math.tan((fov * Math.PI) / 360); // tan(fov/2)

  // Pull-back needed for the worst point. For a camera at LOOK + s·AXIS:
  //   depth_p(s)  = s·AXIS_LEN + F.y·p.y + F.z·(p.z − LOOK.z)
  //   x_ndc_p     = |p.x| / (aspect·tan·depth_p)      (view-right is world +x)
  //   y_ndc_p     = |U·(p−LOOK)| / (tan·depth_p)      (invariant along the ray)
  // Solve s so every point satisfies |ndc| ≤ NDC_LIMIT.
  // Solve against a hair inside the limit so float error can't tip a point
  // a fraction outside the frame.
  const margin = NDC_LIMIT * 0.998;
  const kx = margin * aspect * tan;
  const ky = margin * tan;
  let sReq = 1;
  for (const p of POINTS) {
    const c = F.y * p.y + F.z * (p.z - LOOK.z); // depth offset at s=0
    const yView = U.y * p.y + U.z * (p.z - LOOK.z);
    const depthNeeded = Math.max(Math.abs(p.x) / kx, Math.abs(yView) / ky);
    sReq = Math.max(sReq, (depthNeeded - c) / AXIS_LEN);
  }
  // Never pull closer than the desktop spot — when the FOV alone covers the
  // points (sReq < 1) the position stays put and only the FOV widens.
  const s = 1 + Math.max(0, sReq - 1) * g;
  return {
    fov,
    pos: { x: 0, y: AXIS.y * s, z: LOOK.z + AXIS.z * s },
  };
}
