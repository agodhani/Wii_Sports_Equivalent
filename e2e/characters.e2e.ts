import { test, expect, openGame, waitForPhase, BASE } from './helpers';

interface CharacterState {
  player: { x: number; stride: number; rightArmVisible: boolean; leftArmVisible: boolean };
  cpu: { x: number; stride: number; rightArmVisible: boolean; leftArmVisible: boolean };
  trackedArmVisible: boolean;
}

test('characters run in the demo and replace only the playing arm in pointer mode', async ({ page }, info) => {
  await openGame(page);
  const characters = () => page.evaluate(() =>
    (window as unknown as { __wt: { characters(): CharacterState } }).__wt.characters());
  expect((await characters()).player.rightArmVisible).toBe(true);
  expect((await characters()).player.leftArmVisible).toBe(true);
  expect((await characters()).trackedArmVisible).toBe(false);
  // Observe every rendered frame: a full stride can pass between the default
  // exponential assertion polls, especially during the short CPU demo return.
  for (const who of ['player', 'cpu'] as const) {
    await page.waitForFunction((who) => Math.abs(
      (window as unknown as { __wt: { characters(): CharacterState } }).__wt.characters()[who].stride,
    ) > 0.01, who, { polling: 'raf', timeout: 15_000 });
  }

  await page.click('#home-pointer');
  await waitForPhase(page, 'rally');
  await expect.poll(async () => (await characters()).trackedArmVisible).toBe(true);
  const playing = await characters();
  expect(playing.player.rightArmVisible).toBe(false);
  expect(playing.player.leftArmVisible).toBe(true);
  expect(playing.cpu.rightArmVisible).toBe(true);
  expect(playing.cpu.leftArmVisible).toBe(true);
  await page.screenshot({ path: info.outputPath('tennis-characters-desktop.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('canvas').first()).toHaveJSProperty('clientWidth', 390);
  await page.screenshot({ path: info.outputPath('tennis-characters-mobile.png') });
});

test('procedural character art renders from the front and back', async ({ page }, info) => {
  // A test-only studio view makes small facial/outfit details reviewable;
  // the first test above covers their integration into the real game.
  await page.route('**/character-studio', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<html><body style="margin:0"><canvas id="studio"></canvas></body></html>',
  }));
  await page.goto(`${BASE}/character-studio`);
  const count = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { createAvatar } = await import('/src/render/avatar.ts');
    const canvas = document.querySelector('#studio') as HTMLCanvasElement;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe4edea);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x668578, 2));
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    sun.position.set(-3, 5, 4);
    scene.add(sun);
    const player = { shirt: 0xe05555, skin: 0xf0c9a0, hair: 0x3a2a1a };
    const avatars = [
      createAvatar({ ...player, facing: 1 }),
      createAvatar({ shirt: 0x5566e0, skin: 0xc98d5e, hair: 0x1c1c22, facing: 1, style: 'cropped', racket: true }),
      createAvatar({ ...player, facing: -1 }),
    ];
    avatars.forEach((avatar, i) => {
      avatar.position.x = (i - 1) * 1.3;
      scene.add(avatar);
    });
    const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 30);
    camera.position.set(0, 2.7, 6);
    camera.lookAt(0, 1, 0);
    renderer.render(scene, camera);
    const draws = renderer.info.render.calls;
    renderer.dispose();
    return draws;
  });
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThan(220);
  await page.screenshot({ path: info.outputPath('tennis-character-roster.png') });
});
