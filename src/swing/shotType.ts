import type { ShotType } from '../types';

const BRUSH_SLOPE = 0.35;
const LOB_SLOPE = 1;

export function classifyShot(horizontal: number, rise: number, minRise: number): ShotType {
  if (Math.abs(rise) < minRise || Math.abs(rise) < horizontal * BRUSH_SLOPE) return 'flat';
  if (rise < 0) return 'slice';
  return rise >= horizontal * LOB_SLOPE ? 'lob' : 'topspin';
}
