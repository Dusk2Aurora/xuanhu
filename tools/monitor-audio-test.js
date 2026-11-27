const assert = require('node:assert/strict');
const path = require('node:path');
const { launchBrowser, gameUrl, enterWard } = require('./browser');

async function checkClock(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => {
      if (cb.name !== 'loop') return raf(cb);
      window.wardFrame = cb;
      return 0;
    };
  });
  await page.goto(gameUrl);
  await enterWard(page);
  const result = await page.evaluate(() => {
    const { S, beds, E } = window.__LIFE_GAME;
    // Hold physiology steady while the normal ward loop advances the game clock.
    E.tick = (s, dt) => { s.t += dt; };
    CASEGEN.step = () => {};
    Object.assign(S, { rhythm: 'sinus', hr: 60, spo2: 99, rr: 15, gcs: 15, k: 4, glu: 5,
      ph: 7.4, vent: 0, temp: 37, sv: 90, svr: 18, cvp: 4, opioidTox: true, t: 0, tests: {} });
    let clock = 0;
    const beats = [], alarms = [], warnings = [];
    SOUND.beat = () => beats.push(clock);
    SOUND.alarm = () => alarms.push(clock);
    SOUND.critical = () => warnings.push(clock);
    function run(ms) {
      const end = clock + ms;
      while (clock < end) { clock += 10; window.wardFrame(clock); }
    }
    for (const selector of ['[data-s="1"]', '[data-s="4"]', '[data-s="16"]', '#ff']) {
      document.querySelector(selector).click();
      run(2000);
    }
    document.querySelector('#btnBody').click();
    Array.from(document.querySelectorAll('#sheetList button')).find(b => b.textContent.includes('留观快进')).click();
    const observing = document.querySelector('#ff').textContent === '结束留观';
    run(2000);
    document.querySelector('#ff').click();
    S.hr = 120;
    run(2000);
    const slowBeats = beats.filter(t => t <= 10000);
    const fastBeats = beats.filter(t => t > 10000);
    // A bed already flagged for a low SpO₂ can still develop VF.
    const other = E.create('bleed');
    other.spo2 = 75;
    beds.push({ S: other });
    run(10);
    warnings.length = 0;
    other.rhythm = 'vf';
    S.rhythm = 'vf';
    S._wasSevere = false;
    S._ready = true;
    const arrestAt = clock;
    run(2000);
    S.rhythm = 'asystole';
    run(1100);
    const stoppedBeats = beats.filter(t => t > arrestAt);
    const arrestWarnings = warnings.slice();
    S.rhythm = other.rhythm = 'sinus';
    run(100);
    SOUND.enabled = false;
    S.rhythm = 'vf';
    run(2000);
    const beforeUnmute = alarms.length;
    SOUND.enabled = true;
    run(10);
    return { slowBeats, fastBeats, observing, stoppedBeats, arrestWarnings, beforeUnmute,
      alarms: alarms.map(t => t - arrestAt), restored: beats.at(-1) > arrestAt };
  });
  await page.close();
  assert.ok(result.observing);
  assert.deepEqual(result.slowBeats, Array.from({ length: 10 }, (_, i) => 10 + 1000 * i));
  assert.ok(result.fastBeats.length === 4 && result.fastBeats.slice(1).every((t, i) => t - result.fastBeats[i] === 500));
  assert.deepEqual(result.stoppedBeats, []);
  assert.deepEqual(result.arrestWarnings, []);
  assert.deepEqual(result.alarms.slice(0, 3), [10, 1510, 3010]);
  assert.equal(result.beforeUnmute, 3);
  assert.equal(result.alarms.length, 4);
  assert.ok(result.restored);
}

async function checkWaveform(browser) {
  const page = await browser.newPage();
  await page.evaluate(() => {
    window.offline = new OfflineAudioContext(1, 9 * 48000, 48000);
    window.AudioContext = function () { return window.offline; };
  });
  await page.addScriptTag({ path: path.resolve(__dirname, '../prototype/sound.js') });
  const starts = await page.evaluate(async () => {
    SOUND.beat();
    const cues = [[0.75, 'beat'], [1.5, 'beat'], [2.25, 'beat'], [3, 'critical'],
      [4.5, 'alarm'], [6, 'alarm'], [7.5, 'beat'],
      [8, 'critical'], [8.2, 'alarm'], [8.55, 'stopMonitorAlarm']];
    const events = cues.map(([time, id]) => offline.suspend(time).then(() => {
      SOUND[id]();
      return offline.resume();
    }));
    const buffer = await offline.startRendering();
    await Promise.all(events);
    const samples = buffer.getChannelData(0), starts = [];
    let sounding = false;
    for (let i = 0; i < samples.length; i += 480) {
      let energy = 0;
      for (const value of samples.subarray(i, i + 480)) energy += value * value;
      const on = Math.sqrt(energy / 480) > 0.002;
      if (on && !sounding) starts.push(i / buffer.sampleRate);
      sounding = on;
    }
    return starts;
  });
  await page.close();
  const expected = [0, 0.75, 1.5, 2.25, 3, 3.27, 4.5, 4.7, 4.9, 6, 6.2, 6.4, 7.5, 8, 8.2, 8.4];
  assert.equal(starts.length, expected.length);
  starts.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 0.025, 'Unexpected pulse at ' + v));
}

(async () => {
  const browser = await launchBrowser();
  try {
    await checkClock(browser);
    await checkWaveform(browser);
    console.log('监护音通过：心率实时时序、快进与留观、多床报警、静音和实际音频脉冲。');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
