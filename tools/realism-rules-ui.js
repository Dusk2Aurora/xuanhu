const assert = require('node:assert/strict');
const { enterWard, gameUrl, launchBrowser } = require('./browser');

const conditions = /出院评估|可出院|未达标|稳定期留观|血钾|测试治疗目标/;

async function withPage(browser, scenario, legacyInsurance = false) {
  const page = await browser.newPage({ offline: true, viewport: { width: 1400, height: 950 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(legacy => {
      if (legacy && !sessionStorage.getItem('seededLegacy')) {
        localStorage.setItem('life.realism', '1');
        sessionStorage.setItem('seededLegacy', '1');
      }
      // Keep animation frames available for the UI while controlling the simulation clock.
      const nativeFrame = window.requestAnimationFrame.bind(window);
      let simulationFrame, timestamp = 1000;
      window.requestAnimationFrame = callback => {
        if (callback.name !== 'loop') return nativeFrame(callback);
        simulationFrame = callback;
        return 0;
      };
      window.advanceSimulation = (milliseconds = 0) => simulationFrame(timestamp += milliseconds);
    }, legacyInsurance);
    await page.goto(gameUrl);
    await scenario(page);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function openRules(page) {
  await page.locator('#lobby [data-mode="realism"]').click();
  await page.locator('#sheet.on').getByText('医保与自付', { exact: true }).waitFor();
}

function rule(page, name) {
  return page.locator(`[data-rule="${name}"]`);
}

async function assertRules(page, insurance, signedDischarge) {
  assert.equal(await rule(page, 'insurance').getAttribute('aria-pressed'), String(insurance));
  assert.equal(await rule(page, 'signedDischarge').getAttribute('aria-pressed'), String(signedDischarge));
}

async function startPatient(page) {
  await enterWard(page);
  await page.evaluate(() => {
    const game = window.__LIFE_GAME;
    game.startCase({
      id: 'realism-rules-test', name: '出院规则测试病例', tags: [], goals: ['测试治疗目标'],
      patient: { name: '测试患者', sex: '女', age: 40, height: 165, weight: 60 },
      init: { ...window.CASEGEN.BASE },
    }, true);
    window.dischargeTestPatient = game.S;
  });
  await page.getByText(/查体与化验请自行评估/).click();
}

async function advanceBedCost(page) {
  return page.evaluate(() => {
    const { S } = window.__LIFE_GAME;
    const before = S.bedCost || 0;
    window.advanceSimulation();
    window.advanceSimulation(420);
    return (S.bedCost || 0) - before;
  });
}

async function openSigning(page, checkSheet = true) {
  if (checkSheet) await page.locator('#btnBody').click();
  const checks = page.locator('#sheet.on #sheetList');
  assert.doesNotMatch(await checks.innerText(), conditions);
  await checks.getByText('办理出院', { exact: true }).click();
  const prompt = page.locator('#sheet.on').filter({ hasText: /是否签字出院/ });
  await prompt.waitFor();
  assert.doesNotMatch(await prompt.innerText(), conditions);
  return prompt;
}

async function recordCount(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('life.records') || '[]').length);
}

async function assertSignedOutcome(page, prompt, status) {
  await prompt.getByRole('button', { name: /确认签字出院/ }).click();
  await page.locator('#detail.on .case-review-summary').waitFor();
  const result = await page.evaluate(() => {
    const patient = window.dischargeTestPatient;
    return [patient.dischargeOutcome?.status, patient.running, patient.discharged, patient.death];
  });
  assert.deepEqual(result, [status, false, status !== 'failed', null]);
  assert.equal(await recordCount(page), 1);
}

async function testMigration(page) {
  await openRules(page);
  await assertRules(page, true, false);
  await rule(page, 'insurance').click();
  await rule(page, 'signedDischarge').click();
  await assertRules(page, false, true);
  await page.reload();
  await openRules(page);
  await assertRules(page, false, true);
}

async function testFailedDischarge(page) {
  await startPatient(page);
  await page.locator('#btnLobby').click();
  await openRules(page);
  await assertRules(page, false, false);
  await rule(page, 'insurance').click();
  await assertRules(page, true, false);
  await page.locator('#sheetClose').click();
  await enterWard(page);
  assert.ok(await advanceBedCost(page) > 0);
  await page.evaluate(() => { window.__LIFE_GAME.S.k = 7.2; });
  await page.locator('#btnBody').click();
  await page.locator('#sheet.on').getByText('出院评估', { exact: true }).click();
  assert.match(await page.locator('#detail.on #dWarn').innerText(), /血钾/);
  await page.locator('#detailX').click();
  await page.locator('#sheetClose').click();

  await page.locator('#btnLobby').click();
  await openRules(page);
  await rule(page, 'signedDischarge').click();
  await assertRules(page, true, true);
  await rule(page, 'insurance').click();
  await assertRules(page, false, true);
  await page.locator('#sheetClose').click();
  await enterWard(page);
  assert.equal(await advanceBedCost(page), 0);
  const severeWarning = page.locator('#sevOk');
  if (await severeWarning.isVisible()) await severeWarning.click();
  let prompt = await openSigning(page);
  await prompt.getByText('取消', { exact: true }).click();
  assert.equal(await page.evaluate(() => window.dischargeTestPatient.running), true);
  assert.equal(await recordCount(page), 0);
  prompt = await openSigning(page, false);
  await assertSignedOutcome(page, prompt, 'failed');
  assert.equal(await page.locator('#dName').innerText(), '出院判定失败');
  assert.match(await page.locator('#detail.on').innerText(), /血钾/);

  await page.reload();
  await page.locator('#lobby [data-act="records"]').click();
  await page.locator('#sheet.on').getByText('出院规则测试病例', { exact: true }).click();
  assert.equal(await page.locator('#detail.on #dName').innerText(), '出院判定失败');
  const summary = page.locator('.case-review-summary');
  assert.equal(await summary.locator('dt:has-text("结算时启用") + dd').innerText(), '真实出院');
  assert.equal(await summary.locator('dt:has-text("本例曾启用") + dd').innerText(), '医保与自付、真实出院');
}

async function testSuccessfulDischarges(page, status) {
  await openRules(page);
  await rule(page, 'signedDischarge').click();
  await assertRules(page, false, true);
  await page.locator('#sheetClose').click();
  await startPatient(page);
  if (status === 'penalized') await page.evaluate(() => { window.__LIFE_GAME.S.temp = 38.1; });
  await assertSignedOutcome(page, await openSigning(page), status);
  const deduction = page.locator('.case-review-score').getByRole('row', { name: /出院条件未达标/ });
  if (status === 'penalized') assert.match(await deduction.innerText(), /−30/);
  else assert.equal(await deduction.count(), 0);
}

async function main() {
  const browser = await launchBrowser();
  try {
    await withPage(browser, testMigration, true);
    await withPage(browser, testFailedDischarge);
    await withPage(browser, page => testSuccessfulDischarges(page, 'penalized'));
    await withPage(browser, page => testSuccessfulDischarges(page, 'normal'));
    console.log('Realism rule migration, billing, signed discharge outcomes, and persistent case records passed.');
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
