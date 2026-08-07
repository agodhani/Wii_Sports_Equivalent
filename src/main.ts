import { startCamera } from './camera';
import { PoseTracker } from './tracking/pose';
import { Scene } from './render/scene';
import { Hud } from './render/hud';

const video = document.getElementById('webcam') as HTMLVideoElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const root = document.getElementById('hud') as HTMLElement;

async function main() {
  await startCamera(video);
  const tracker = await PoseTracker.create();
  const scene = new Scene(canvas);
  const hud = new Hud(root, video);

  function loop() {
    const t = performance.now() / 1000;
    const frame = tracker.process(video, t);
    hud.setPreviewFrame(frame);
    scene.setBall({
      x: Math.sin(t) * 2,
      y: Math.abs(Math.sin(t * 3)) * 2 + 0.11,
      z: Math.sin(t * 0.7) * 8,
    });
    scene.render();
    requestAnimationFrame(loop);
  }
  loop();
}
main();
