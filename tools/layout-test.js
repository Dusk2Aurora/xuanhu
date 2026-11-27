const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { gameUrl, launchBrowser } = require('./browser');

const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'mobile', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
];

async function checkHorizontalFit(page, sections) {
  const overflowing = await page.evaluate(selectors => selectors.filter(selector => {
    const element = document.querySelector(selector);
    const bounds = element.getBoundingClientRect();
    return bounds.left < -1 || bounds.right > window.innerWidth + 1 ||
      element.scrollWidth > element.clientWidth + 1;
  }), sections);
  assert.deepEqual(overflowing, [], '横向溢出区域');
}

async function checkDock(page) {
  const targets = await page.locator('.dock button').evaluateAll(buttons => buttons.map(button => {
    const { left, right, top, bottom, width, height } = button.getBoundingClientRect();
    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    return {
      id: button.id,
      label: button.textContent.trim(),
      visible: left >= 0 && right <= window.innerWidth && top >= 0 && bottom <= window.innerHeight,
      touchable: width >= 44 && height >= 44 && button.contains(hit),
    };
  }));
  assert.deepEqual(targets.map(target => target.id).sort(), ['btnBlood', 'btnBody', 'btnDrug', 'btnMenu', 'btnOps']);
  for (const target of targets) {
    assert.ok(target.visible && target.touchable && target.label, JSON.stringify(target));
  }
}

async function checkLayout(browser, profile, screenshotDir) {
  const { name, ...options } = profile;
  const page = await browser.newPage({ ...options, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(7000);
  const activate = options.hasTouch ? locator => locator.tap() : locator => locator.click();
  try {
    await page.goto(gameUrl);
    assert.equal(await page.evaluate(() => window.innerWidth), options.viewport.width);
    const lobby = page.locator('#lobby');
    const sheet = page.locator('#sheet');
    const title = page.locator('#sheetTitle');
    await lobby.waitFor();
    await checkHorizontalFit(page, ['html', '#lobby', '.lobby-beds', '.lobby-tools']);
    if (screenshotDir && name === 'desktop') {
      await page.screenshot({ path: path.join(screenshotDir, 'lobby-desktop.png') });
    }

    await activate(lobby.locator('[data-act="tutorial"]'));
    await sheet.waitFor();
    assert.match(await title.textContent(), /^教程/);
    await activate(page.locator('[data-pg="1"]'));
    assert.match(await title.textContent(), /\b2\/\d+/);
    await activate(page.locator('#sheetClose'));
    await lobby.waitFor();

    await activate(lobby.locator('[data-act="diff"]'));
    await sheet.waitFor();
    assert.match(await title.textContent(), /^难度设置/);
    assert.equal(await sheet.getByText('病例难度', { exact: true }).count(), 1);
    assert.equal(await sheet.getByText('指导强度', { exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    await lobby.waitFor();

    const bed = lobby.locator('[data-bed][aria-current="true"]');
    const expectedName = await bed.locator('.nm').evaluate(label => label.firstChild.textContent);
    await activate(bed);
    await lobby.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#pname').textContent(), expectedName);
    await checkHorizontalFit(page, ['html', '.top', '.stage', '.dock', '#vitals', '#states']);
    await checkDock(page);
    assert.equal(await page.locator('#vitals .vpill:visible').count(), 6);
    if (screenshotDir) {
      if (!options.hasTouch) await page.mouse.move(0, 0);
      await page.screenshot({ path: path.join(screenshotDir, `ward-${name}.png`) });
    }

    const drug = page.locator('#btnDrug');
    await activate(drug);
    await sheet.waitFor();
    assert.match(await title.textContent(), /^给药/);
    await checkHorizontalFit(page, ['#sheet', '#sheetList']);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'hidden' });
    assert.equal(await drug.evaluate(button => button === document.activeElement), true, '给药关闭后恢复焦点');

    const brain = page.locator('#anat [data-o="brain"]');
    const brainHasFocus = () => brain.evaluate(organ => organ === document.activeElement);
    for (let step = 0; step < 30 && !await brainHasFocus(); step++) {
      await page.keyboard.press('Tab');
    }
    assert.ok(await brainHasFocus(), 'Tab 可聚焦器官');
    await page.keyboard.press('Enter');
    assert.equal(await brain.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#opTitle').textContent(), '脑');
    assert.deepEqual(errors, []);
    console.log(`${name} ${options.viewport.width}×${options.viewport.height} 界面验收通过`);
  } finally {
    await page.close();
  }
}

async function main() {
  const screenshotDir = process.argv.includes('--screenshots') ? path.resolve(__dirname, '../shots') : null;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const browser = await launchBrowser();
  try {
    for (const profile of profiles) await checkLayout(browser, profile, screenshotDir);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
