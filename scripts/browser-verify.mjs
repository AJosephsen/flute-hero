import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url);
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
]);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const rel = normalize(pathname).replace(/^([/\\])+/, '');
    if (rel.startsWith('..')) throw new Error('bad path');
    const file = join(root.pathname, rel);
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': mime.get(extname(file)) ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];

page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', error => pageErrors.push(error.message));

await page.addInitScript(() => {
  const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  window.__fluteHeroOriginalGetUserMedia = Boolean(original);

  navigator.mediaDevices ??= {};
  navigator.mediaDevices.getUserMedia = async () => {
    const audio = new AudioContext({ latencyHint: 'interactive' });
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const destination = audio.createMediaStreamDestination();

    oscillator.type = 'sine';
    oscillator.frequency.value = 440;
    gain.gain.value = 0.22;
    oscillator.connect(gain).connect(destination);
    oscillator.start();

    window.__fluteHeroSyntheticMic = { audio, oscillator };
    return destination.stream;
  };
});

try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#startButton').click();
  await page.waitForFunction(() => document.querySelector('#startButton')?.textContent?.includes('Listening'));
  await page.waitForFunction(() => document.querySelector('#detectedNote')?.textContent?.includes('A4'), null, { timeout: 5000 });

  const result = await page.evaluate(() => ({
    detected: document.querySelector('#detectedNote')?.textContent,
    target: document.querySelector('#targetNote')?.textContent,
    accuracy: document.querySelector('#accuracy')?.textContent,
    debug: {
      frameTime: document.querySelector('#debugFrameTime')?.textContent,
      audioLatency: document.querySelector('#debugAudioLatency')?.textContent,
      frequency: document.querySelector('#debugFrequency')?.textContent,
      confidence: document.querySelector('#debugConfidence')?.textContent,
    },
    canvas: {
      width: document.querySelector('#noteLane')?.width,
      height: document.querySelector('#noteLane')?.height,
    },
    audioState: window.__fluteHeroSyntheticMic?.audio?.state,
    hadNativeGetUserMedia: window.__fluteHeroOriginalGetUserMedia,
  }));

  if (!result.debug.frequency?.includes('Hz') || !result.debug.frameTime?.includes('ms')) {
    throw new Error(`Debug overlay did not populate: ${JSON.stringify(result.debug)}`);
  }

  if (consoleErrors.length || pageErrors.length) {
    throw new Error(`Browser errors: ${JSON.stringify({ consoleErrors, pageErrors }, null, 2)}`);
  }

  console.log(JSON.stringify({ ok: true, url, result }, null, 2));
} finally {
  await browser.close();
  server.close();
}
