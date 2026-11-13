import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const homeURL = new URL('../client/public/home.html', import.meta.url).href;
let browser;

before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function openHome(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...options });
  await page.goto(homeURL);
  return page;
}

async function waitUntil(page, predicate) {
  await page.waitForFunction(predicate);
}

async function reachHome(page) {
  for (let index = 0; index < 3; index++) {
    await page.keyboard.press('ArrowDown');
    if (index < 2) {
      await page.waitForFunction((next) => document.querySelectorAll('.splash')[next]?.classList.contains('is-active'), index + 1);
      await page.waitForTimeout(50);
    }
  }
  await waitUntil(page, () => !document.querySelector('.splashes') && !document.documentElement.classList.contains('home-arriving'));
}

test('the intro permits native pinch zoom', async () => {
  const page = await openHome({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    assert.equal(await page.locator('.splashes').evaluate((el) => getComputedStyle(el).touchAction), 'pinch-zoom');
    const session = await page.context().newCDPSession(page);
    const before = await page.evaluate(() => visualViewport.scale);
    await session.send('Input.synthesizePinchGesture', {
      x: 195, y: 420, scaleFactor: 1.5, gestureSourceType: 'touch', relativeSpeed: 400,
    });
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate((initial) => visualViewport.scale > initial, before));
    assert.equal(await page.locator('.splash.is-active').getAttribute('aria-label'), 'Introduction 1 of 3');
  } finally {
    await page.close();
  }
});

test('short viewports can scroll through the complete message before the next gesture advances', async () => {
  const page = await openHome({ viewport: { width: 320, height: 240 }, reducedMotion: 'reduce' });
  try {
    const slide = page.locator('.splash').first();
    const headline = await slide.locator('.splash-line').boundingBox();
    assert.ok(headline.y >= 0, 'The start of an overflowing message must remain reachable');
    assert.equal(await slide.evaluate((el) => getComputedStyle(el).overflowY), 'auto');
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(80);
    assert.ok(await slide.evaluate((el) => el.scrollTop > 0));
    assert.equal(await page.locator('.splash.is-active').getAttribute('aria-label'), 'Introduction 1 of 3');
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(250);
    assert.ok(await slide.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2));
    const end = await slide.locator('.splash-line').boundingBox();
    assert.ok(end.y + end.height <= 240, 'The end of the message must be readable');
    assert.equal(await page.locator('.splash.is-active').getAttribute('aria-label'), 'Introduction 1 of 3');
    await page.mouse.wheel(0, 100);
    await page.waitForFunction(() => document.querySelectorAll('.splash')[1].classList.contains('is-active'));
  } finally {
    await page.close();
  }
});

test('touch users can finish reading an overflowing message without accidentally advancing', async () => {
  const page = await openHome({ viewport: { width: 320, height: 240 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const session = await page.context().newCDPSession(page);
  async function swipe(fromY, toY) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: fromY }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 160, y: toY }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  try {
    const slide = page.locator('.splash').first();
    await swipe(210, 130);
    assert.ok(await slide.evaluate((el) => el.scrollTop > 0));
    assert.equal(await page.locator('.splash.is-active').getAttribute('aria-label'), 'Introduction 1 of 3');
    await swipe(239, 1);
    assert.ok(await slide.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2));
    assert.equal(await page.locator('.splash.is-active').getAttribute('aria-label'), 'Introduction 1 of 3');
    await swipe(210, 100);
    await page.waitForFunction(() => document.querySelectorAll('.splash')[1].classList.contains('is-active'));
  } finally {
    await page.close();
  }
});

test('oversized intro text can be read using keyboard scrolling before advancing', async () => {
  const page = await openHome({ viewport: { width: 390, height: 420 }, reducedMotion: 'reduce' });
  try {
    await page.addStyleTag({ content: '.splash-line { font-size: 72px !important; }' });
    await page.evaluate(() => dispatchEvent(new Event('resize')));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.keyboard.press('ArrowDown');
    const slide = page.locator('.splash').first();
    assert.ok(await slide.evaluate((el) => el.scrollTop > 0));
    assert.equal(await page.locator('.splash.is-active').getAttribute('aria-label'), 'Introduction 1 of 3');
    await page.keyboard.press('End');
    assert.ok(await slide.evaluate((el) => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 2));
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.querySelectorAll('.splash')[1].classList.contains('is-active'));
  } finally {
    await page.close();
  }
});

test('mobile swipes preserve centering, direction, and normal home-page scrolling', async () => {
  const page = await openHome({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const session = await page.context().newCDPSession(page);
  async function swipe(fromX, fromY, toX, toY) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y: fromY }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: toX, y: toY }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  try {
    const box = await page.locator('.splash-line').first().boundingBox();
    assert.ok(Math.abs(box.y + box.height / 2 - 422) < 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (let i = 1; i <= 3; i++) {
      await swipe(280, 650, 130, 330);
      if (i < 3) {
        await page.waitForSelector('.pixel-transition');
        await page.waitForFunction((index) => document.querySelectorAll('.splash')[index].classList.contains('is-active'), i);
      } else {
        await waitUntil(page, () => !document.querySelector('.splashes') && !document.documentElement.classList.contains('home-arriving'));
      }
    }
    assert.equal(await page.evaluate(() => scrollY), 0);
    await swipe(190, 700, 190, 250);
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => scrollY > 0), 'Ordinary touch scrolling must resume after the intro');
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    assert.equal(await page.locator('.splashes').count(), 0);
  } finally {
    await page.close();
  }
});

test('trackpad momentum cannot skip messages or scroll past the landing-page arrival', async () => {
  const page = await openHome();
  async function wheelBurst(duration) {
    const started = performance.now();
    while (performance.now() - started < duration) {
      await page.mouse.wheel(0, 60);
      await page.waitForTimeout(35);
    }
  }
  try {
    for (let i = 1; i <= 3; i++) {
      await wheelBurst(i === 3 ? 1800 : 850);
      if (i < 3) {
        assert.equal(await page.locator('.splash.is-active').getAttribute('aria-label'), `Introduction ${i + 1} of 3`);
        await page.waitForTimeout(250);
      }
    }
    assert.equal(await page.locator('.splashes').count(), 0);
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.waitForTimeout(250);
    await page.mouse.wheel(0, 280);
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => scrollY > 0));
  } finally {
    await page.close();
  }
});

test('reduced motion skips particle effects and the existing skip link bypasses the intro', async () => {
  const page = await openHome({ reducedMotion: 'reduce' });
  try {
    await page.evaluate(() => {
      window.pixelCanvases = 0;
      new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
        if (node.classList?.contains('pixel-transition')) window.pixelCanvases++;
      }))).observe(document.body, { childList: true });
    });
    await reachHome(page);
    assert.equal(await page.evaluate(() => window.pixelCanvases), 0);
    await page.goto(homeURL);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip');
    await page.keyboard.press('Enter');
    await waitUntil(page, () => !document.documentElement.classList.contains('home-arriving'));
    assert.equal(await page.locator('.splashes').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  } finally {
    await page.close();
  }
});

test('existing section deep links open the requested home section instead of trapping users in the intro', async () => {
  const page = await openHome({ reducedMotion: 'reduce' });
  try {
    await page.goto('about:blank');
    await page.goto(`${homeURL}#what`);
    assert.equal(await page.locator('.splashes').count(), 0);
    assert.equal(await page.locator('.site-header').isVisible(), true);
    const box = await page.locator('#what').boundingBox();
    assert.ok(box.y >= 72 && box.y < 180);
  } finally {
    await page.close();
  }
});

test('without JavaScript, the intro is readable, navigation follows it, and More still works', async () => {
  const page = await openHome({ javaScriptEnabled: false });
  try {
    assert.equal(await page.locator('.splash').count(), 3);
    const nav = await page.locator('.site-header').boundingBox();
    assert.ok(nav.y >= 2700, 'Navigation should follow the three intro viewports');
    await page.locator('#what summary').click();
    assert.equal(await page.locator('.tiers').isVisible(), true);
  } finally {
    await page.close();
  }
});

test('assembly excludes collapsed prose and leaves no page-wide focus outline', async () => {
  const page = await openHome();
  try {
    await page.locator('.skip').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('html.home-arriving .pixel-transition');
    await waitUntil(page, () => !document.documentElement.classList.contains('home-arriving'));
    assert.equal(await page.locator('.pixel-transition').count(), 0);
    assert.equal(await page.locator('main').evaluate((el) => getComputedStyle(el).outlineStyle), 'none');
  } finally {
    await page.close();
  }
});

test('Why, What, and How show one sentence each and expand independently by mouse or keyboard', async () => {
  const page = await openHome({ reducedMotion: 'reduce' });
  try {
    await reachHome(page);
    const expected = {
      why: 'Without a change, surveillance capitalism will continue to railroad the human experience as “raw material for the hidden commercial practices of extraction, prediction, and sales.”1',
      what: 'A privacy-first AI platform (think ChatGPT-interface but with more models to choose from) which democratizes enterprise-grade privacy, giving individual users a level of control previously only available to organizations managing their own AI infrastructure.',
      how: 'Enterprise-grade privacy for AI is well established with platforms like LibreChat, which is trusted by thousands of organizations worldwide including Shopify, Daimler Truck and Boston University.',
    };
    for (const [id, sentence] of Object.entries(expected)) {
      const section = page.locator(`#${id}`);
      assert.equal(await section.locator(':scope > p').count(), 1);
      assert.equal((await section.locator(':scope > p').textContent()).trim(), sentence);
      assert.equal(await section.locator('details').getAttribute('open'), null);
      assert.equal(await section.locator('summary').isVisible(), true);
    }
    assert.equal(await page.locator('.tiers').isVisible(), false);
    assert.equal(await page.locator('.trust').isVisible(), false);
    await page.locator('#what summary').click();
    assert.equal(await page.locator('.tiers').isVisible(), true);
    assert.equal(await page.locator('#why details').getAttribute('open'), null);
    assert.equal(await page.locator('#how details').getAttribute('open'), null);
    await page.locator('#how summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.trust').isVisible(), true);
    await page.locator('#what summary').click();
    assert.equal(await page.locator('.tiers').isVisible(), false);
    assert.equal(await page.locator('.trust').isVisible(), true);
  } finally {
    await page.close();
  }
});

test('the landing page assembles from pixels before becoming interactive', async () => {
  const page = await openHome();
  try {
    for (let i = 1; i <= 2; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForFunction((index) => document.querySelectorAll('.splash')[index].classList.contains('is-active'), i);
    }
    await page.keyboard.press('ArrowDown');
    await page.waitForSelector('html.home-arriving .pixel-transition', { timeout: 2000 });
    assert.equal(await page.locator('.content-title').isVisible(), false);
    assert.equal(await page.locator('main').evaluate((el) => el.inert), true);
    await page.waitForTimeout(140);
    const scattered = await pixelCenter(page);
    assert.ok(scattered.count > 100);
    await page.waitForTimeout(150);
    const assembling = await pixelCenter(page);
    assert.ok(assembling.y < scattered.y, 'Incoming blocks should fly upward into their final positions');
    await waitUntil(page, () => !document.documentElement.classList.contains('home-arriving'));
    assert.equal(await page.locator('.pixel-transition').count(), 0);
    assert.equal(await page.locator('.content-title').isVisible(), true);
    assert.equal(await page.locator('main').evaluate((el) => el.inert), false);
  } finally {
    await page.close();
  }
});

test('the final swipe makes the landing page the permanent scroll origin', async () => {
  const page = await openHome();
  try {
    await reachHome(page);
    assert.equal(await page.locator('.splashes').count(), 0);
    assert.equal(await page.evaluate(() => scrollY), 0);
    const title = await page.locator('.content-title').boundingBox();
    assert.ok(title.y >= 72 && title.y < 160, `Landing title should be near the top: ${title.y}`);
    await page.evaluate(() => scrollTo({ top: 500, behavior: 'instant' }));
    await page.mouse.wheel(0, -2000);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => scrollY), 0);
    await page.locator('.brand').click();
    await page.waitForTimeout(100);
    assert.equal(await page.locator('.splashes').count(), 0);
  } finally {
    await page.close();
  }
});

test('navigation stays hidden and unfocusable throughout the intro, then appears at home', async () => {
  const page = await openHome();
  try {
    assert.equal(await page.locator('.site-header').isVisible(), false);
    assert.equal(await page.locator('.site-header').evaluate((el) => el.inert), true);
    await reachHome(page);
    assert.equal(await page.locator('.site-header').isVisible(), true);
    assert.equal(await page.locator('.site-header').evaluate((el) => el.inert), false);
    await page.locator('.site-nav a[href="#about"]').click();
    await page.waitForTimeout(400);
    const box = await page.locator('#about').boundingBox();
    assert.ok(box.y >= 70, 'Sticky navigation must not obscure an anchor target');
  } finally {
    await page.close();
  }
});

async function pixelCenter(page) {
  return page.locator('.pixel-transition').evaluate((canvas) => {
    const { width, height } = canvas;
    const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    let xSum = 0, ySum = 0, count = 0;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        if (pixels[(y * width + x) * 4 + 3] < 40) continue;
        xSum += x;
        ySum += y;
        count++;
      }
    }
    return { x: xSum / count, y: ySum / count, count };
  });
}

test('outgoing text breaks into pixels that follow the diagonal scroll trajectory', async () => {
  const page = await openHome();
  try {
    await page.mouse.wheel(120, 180);
    await page.waitForSelector('.pixel-transition', { timeout: 1500 });
    await page.waitForTimeout(40);
    const start = await pixelCenter(page);
    assert.ok(start.count > 100, 'The transition must render actual pixels');
    assert.equal(await page.locator('.splash-line').first().evaluate((el) => getComputedStyle(el).visibility), 'hidden');
    await page.waitForTimeout(110);
    const later = await pixelCenter(page);
    assert.ok(later.x < start.x - 12, `Pixels should move left: ${start.x} → ${later.x}`);
    assert.ok(later.y < start.y - 20, `Pixels should move up: ${start.y} → ${later.y}`);
    await waitUntil(page, () => document.querySelectorAll('.splash')[1].classList.contains('is-active'));
    assert.equal(await page.locator('.pixel-transition').count(), 0);
  } finally {
    await page.close();
  }
});

test('intro headlines are vertically centered and each wheel gesture settles on one message', async () => {
  const page = await openHome();
  try {
    const centerOffset = await page.locator('.splash-line').first().evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return Math.abs(rect.top + rect.height / 2 - innerHeight / 2);
    });
    assert.ok(centerOffset < 2, `Headline is ${centerOffset}px away from the viewport center`);
    await page.mouse.wheel(0, 180);
    await waitUntil(page, () => document.querySelectorAll('.splash')[1].classList.contains('is-active'));
    await page.waitForTimeout(800);
    assert.equal(await page.locator('.splash.is-active').count(), 1);
    const secondOffset = await page.locator('.splash').nth(1).locator('.splash-line').evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return Math.abs(rect.top + rect.height / 2 - innerHeight / 2);
    });
    assert.ok(secondOffset < 2, `Second headline is ${secondOffset}px off center`);
    await page.mouse.wheel(0, -180);
    await waitUntil(page, () => document.querySelectorAll('.splash')[0].classList.contains('is-active'));
  } finally {
    await page.close();
  }
});
