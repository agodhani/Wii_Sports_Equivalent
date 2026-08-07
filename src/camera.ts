export async function startCamera(video: HTMLVideoElement): Promise<void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotAllowedError') {
      throw new Error('camera-denied');
    }
    throw new Error('camera-unavailable');
  }
  video.srcObject = stream;
  await video.play();
}
