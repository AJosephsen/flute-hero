import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url);
const mime = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js',   'text/javascript; charset=utf-8'],
  ['.css',  'text/css; charset=utf-8'],
  ['.svg',  'image/svg+xml'],
  ['.png',  'image/png'],
  ['.json', 'application/json'],
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
    res.writeHead(404); res.end('not found');
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const base = `http://127.0.0.1:${port}/`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Full HD viewport — simulates a reasonable desktop/tablet size
await page.setViewportSize({ width: 1280, height: 800 });

const consoleErrors = [];
const pageErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => pageErrors.push(e.message));

// Synthetic mic: 880 Hz sine → A5
await page.addInitScript(() => {
  navigator.mediaDevices ??= {};
  navigator.mediaDevices.getUserMedia = async () => {
    const audio = new AudioContext({ latencyHint: 'interactive' });
    const osc   = audio.createOscillator();
    const gain  = audio.createGain();
    const dest  = audio.createMediaStreamDestination();
    osc.type = 'sine'; osc.frequency.value = 880;
    gain.gain.value = 0.3;
    osc.connect(gain).connect(dest);
    osc.start();
    window.__syntheticMic = { audio, osc };
    return dest.stream;
  };
  // fullscreen is caught inside main.js; no stub needed
});

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? '✓' : '✗'} ${label}${detail ? ': ' + detail : ''}`);
};

try {
  // ── 1. Home screen ─────────────────────────────────────────────────────────
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/fh-01-home.png' });

  const homeTitle = await page.textContent('h1').catch(() => '');
  check('Home screen: h1 present', homeTitle.includes('flute-hero'), homeTitle);
  check('Home screen: Let\'s Play button present', await page.locator('#btnStart').count() > 0);

  // ── 2. Level select ─────────────────────────────────────────────────────────
  await page.locator('#btnStart').click();
  await page.waitForSelector('.levels-screen', { timeout: 5000 });
  await page.screenshot({ path: '/tmp/fh-02-levels.png' });

  const levelCards = await page.locator('.level-card').count();
  check('Level select: 3 level cards', levelCards === 3, `${levelCards} cards`);

  const songBtns = await page.locator('.song-btn').count();
  check('Level select: 9 song buttons', songBtns === 9, `${songBtns} buttons`);

  const unlocked = await page.locator('.song-btn:not([disabled])').count();
  check('Level select: 1 song unlocked initially', unlocked === 1, `${unlocked} unlocked`);

  const lockedLevels = await page.locator('.level-card.locked').count();
  check('Level select: 2 levels locked', lockedLevels === 2, `${lockedLevels} locked`);

  // ── 3. Start first song → fullscreen lane + HUD ─────────────────────────────
  await page.locator('.song-btn:not([disabled])').first().click();

  // lane shell becomes active
  await page.waitForFunction(() =>
    document.querySelector('#laneShell')?.classList.contains('active'), null, { timeout: 5000 });
  // HUD is injected into body
  await page.waitForSelector('.play-hud', { timeout: 3000 });
  await page.screenshot({ path: '/tmp/fh-03-playing.png' });

  const hudTitle = await page.textContent('.hud-title').catch(() => '');
  check('Playing: HUD title shows song name', hudTitle.includes('Hot Cross Buns'), hudTitle);

  // canvas is visible and sized
  const canvasSize = await page.evaluate(() => {
    const c = document.querySelector('#noteLane');
    return { w: c?.width, h: c?.height };
  });
  check('Playing: canvas has non-zero size', canvasSize.w > 0 && canvasSize.h > 0, JSON.stringify(canvasSize));

  // ── 4. Pitch detection ───────────────────────────────────────────────────────
  await page.waitForFunction(() => {
    const el = document.querySelector('#detectedNote');
    return el && el.textContent.trim() !== '—';
  }, null, { timeout: 7000 });
  await page.screenshot({ path: '/tmp/fh-04-playing-pitch.png' });

  const detected = await page.textContent('#detectedNote').catch(() => '');
  check('Playing: pitch detected (A5 from synth mic)', detected.includes('A5'), detected);

  // ── 5. Debug panel ───────────────────────────────────────────────────────────
  const frameTime = await page.textContent('#debugFrameTime').catch(() => '');
  const freq      = await page.textContent('#debugFrequency').catch(() => '');
  check('Debug: frame time populated', frameTime.includes('ms'), frameTime);
  check('Debug: frequency populated', freq.includes('Hz'), freq);

  // ── 6. Canvas painted ────────────────────────────────────────────────────────
  const painted = await page.evaluate(() => {
    const c = document.querySelector('#noteLane');
    if (!c) return false;
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return px.some(v => v > 0);
  });
  check('Canvas: pixels painted', painted);

  // ── 7. Back button hides lane ────────────────────────────────────────────────
  await page.locator('#hudBack').click();
  await page.waitForSelector('.levels-screen', { timeout: 4000 });
  const laneHidden = await page.evaluate(() =>
    !document.querySelector('#laneShell')?.classList.contains('active'));
  check('Back: lane shell hidden', laneHidden);
  await page.screenshot({ path: '/tmp/fh-05-back-to-levels.png' });

  // ── 8. No errors ─────────────────────────────────────────────────────────────
  check('No console errors', consoleErrors.length === 0, consoleErrors.join('; '));
  check('No page errors',    pageErrors.length === 0,    pageErrors.join('; '));

} finally {
  await browser.close();
  server.close();
}

const failed = results.filter(r => !r.pass);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} checks passed ✓`);
}
