import { startCamera } from './camera';
import { PoseTracker } from './tracking/pose';
import { SwingDetector } from './swing/detector';

const video = document.getElementById('webcam') as HTMLVideoElement;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
canvas.width = 640; canvas.height = 480;

async function main() {
  await startCamera(video);
  const tracker = await PoseTracker.create();
  const detector = new SwingDetector('right');

  function loop() {
    const t = performance.now() / 1000;
    const frame = tracker.process(video, t);
    ctx.save();
    ctx.scale(-1, 1); ctx.drawImage(video, -640, 0, 640, 480); // mirrored preview
    ctx.restore();
    if (frame && !frame.trackingLost) {
      ctx.fillStyle = 'lime';
      for (const p of [frame.leftWrist, frame.rightWrist, frame.leftShoulder,
                       frame.rightShoulder, frame.leftHip, frame.rightHip]) {
        // pose-space x is already mirrored; the preview above is mirrored too,
        // so draw at p.x directly
        ctx.beginPath(); ctx.arc(p.x * 640, p.y * 480, 6, 0, 7); ctx.fill();
      }
      const swing = detector.update(frame);
      if (swing) console.log('SWING', swing.side, swing.speed.toFixed(1), swing.direction.toFixed(2));
    } else {
      ctx.fillStyle = 'red'; ctx.font = '24px sans-serif';
      ctx.fillText('tracking lost', 20, 40);
    }
    requestAnimationFrame(loop);
  }
  loop();
}
main();
