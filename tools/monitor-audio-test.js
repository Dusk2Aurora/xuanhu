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
    let flatlineStarts = 0, flatlinePlaying = false;
    SOUND.beat = () => beats.push(clock);
    SOUND.alarm = () => alarms.push(clock);
    SOUND.critical = () => warnings.push(clock);
    SOUND.flatline = () => { flatlineStarts++; flatlinePlaying = true; };
    SOUND.stopMonitorAlarm = () => { flatlinePlaying = false; };
    Object.defineProperty(SOUND, 'flatlinePlaying', { get: () => flatlinePlaying });
    function run(ms) {
      const end = clock + ms;
      while (clock < end) { clock += 10; window.wardFrame(clock); }
    }
    function alarmState() {
      return { vfGroups: alarms.length, flatlineStarts, flatlinePlaying };
    }
    function clickMenuRow(name) {
      document.querySelector('#btnMenu').click();
      Array.from(document.querySelectorAll('#sheetList .nm')).find(el => el.textContent === name)
        .closest('button').click();
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
    const vfTimes = alarms.map(t => t - arrestAt);
    S.rhythm = 'asystole';
    run(2000);
    const currentAsystole = alarmState();
    document.querySelector('#btnLobby').click();
    document.querySelector('#lobby [data-bed="1"]').click();
    run(10);
    const currentVf = alarmState();
    const stoppedBeats = beats.filter(t => t > arrestAt);
    const arrestWarnings = warnings.slice();

    other.rhythm = 'sinus';
    other.spo2 = 99;
    run(10);
    const backgroundAsystole = alarmState();
    const third = E.create('bleed');
    third.rhythm = 'vf';
    beds.push({ S: third });
    run(10);
    const backgroundVf = alarmState();
    third.rhythm = 'sinus';
    run(10);

    clickMenuRow('暂停');
    run(2000);
    const paused = alarmState();
    clickMenuRow('继续（已暂停）');
    run(10);
    const resumed = alarmState();
    SOUND.enabled = false;
    run(2000);
    const muted = alarmState();
    SOUND.enabled = true;
    run(10);
    const unmuted = alarmState();
    S.rhythm = 'sinus';
    const recoveredAt = clock;
    run(2000);
    return { slowBeats, fastBeats, observing, stoppedBeats, arrestWarnings, vfTimes,
      currentAsystole, currentVf, backgroundAsystole, backgroundVf, paused, resumed, muted, unmuted,
      recovered: alarmState(), recoveredBeats: beats.filter(t => t > recoveredAt) };
  });
  await page.close();
  assert.ok(result.observing);
  assert.deepEqual(result.slowBeats, Array.from({ length: 10 }, (_, i) => 10 + 1000 * i));
  assert.ok(result.fastBeats.length === 4 && result.fastBeats.slice(1).every((t, i) => t - result.fastBeats[i] === 500));
  assert.deepEqual(result.stoppedBeats, []);
  assert.deepEqual(result.arrestWarnings, []);
  assert.deepEqual(result.vfTimes, [10, 1510]);
  assert.deepEqual(result.currentAsystole, { vfGroups: 2, flatlineStarts: 1, flatlinePlaying: true });
  assert.deepEqual(result.currentVf, { vfGroups: 3, flatlineStarts: 1, flatlinePlaying: false });
  assert.deepEqual(result.backgroundAsystole, { vfGroups: 3, flatlineStarts: 2, flatlinePlaying: true });
  assert.deepEqual(result.backgroundVf, { vfGroups: 4, flatlineStarts: 2, flatlinePlaying: false });
  assert.deepEqual(result.paused, { vfGroups: 4, flatlineStarts: 3, flatlinePlaying: false });
  assert.deepEqual(result.resumed, { vfGroups: 4, flatlineStarts: 4, flatlinePlaying: true });
  assert.deepEqual(result.muted, { vfGroups: 4, flatlineStarts: 4, flatlinePlaying: false });
  assert.deepEqual(result.unmuted, { vfGroups: 4, flatlineStarts: 5, flatlinePlaying: true });
  assert.deepEqual(result.recovered, { vfGroups: 4, flatlineStarts: 5, flatlinePlaying: false });
  assert.ok(result.recoveredBeats.length > 0);
}

async function checkWaveform(browser) {
  const page = await browser.newPage();
  await page.evaluate(() => {
    window.offline = new OfflineAudioContext(1, 16 * 48000, 48000);
    window.AudioContext = function () { return window.offline; };
  });
  await page.addScriptTag({ path: path.resolve(__dirname, '../prototype/sound.js') });
  const sounds = await page.evaluate(async () => {
    SOUND.beat();
    const cues = [[0.75, 'beat'], [1.5, 'beat'], [2.25, 'beat'], [3, 'critical'],
      [4.5, 'alarm'], [6, 'alarm'], [7.5, 'beat'],
      [8, 'critical'], [8.2, 'alarm'], [8.55, 'stopMonitorAlarm'],
      [9, 'flatline'], [10, 'flatline'], [11, 'critical'], [12, 'stopMonitorAlarm'],
      [12.5, 'flatline'], [13, 'mute'], [13.5, 'unmute'],
      [14, 'alarm'], [14.35, 'flatline'], [15.05, 'stopMonitorAlarm'], [15.5, 'beat']];
    const events = cues.map(([time, id]) => offline.suspend(time).then(() => {
      if (id === 'mute' || id === 'unmute') SOUND.enabled = id === 'unmute';
      else SOUND[id]();
      return offline.resume();
    }));
    const buffer = await offline.startRendering();
    await Promise.all(events);
    const samples = buffer.getChannelData(0), sounds = [];
    let sounding = false;
    for (let i = 0; i < samples.length; i += 480) {
      let energy = 0;
      for (const value of samples.subarray(i, i + 480)) energy += value * value;
      const on = Math.sqrt(energy / 480) > 0.002;
      if (on && !sounding) sounds.push({ start: i / buffer.sampleRate });
      if (!on && sounding) sounds.at(-1).end = i / buffer.sampleRate;
      sounding = on;
    }
    return sounds;
  });
  await page.close();
  const expected = [0, 0.75, 1.5, 2.25, 3, 3.27, 4.5, 4.7, 4.9, 6, 6.2, 6.4, 7.5, 8, 8.2, 8.4,
    9, 12.5, 14, 14.2, 14.35, 15.5];
  assert.equal(sounds.length, expected.length);
  sounds.forEach(({ start }, i) => assert.ok(Math.abs(start - expected[i]) < 0.025, 'Unexpected sound at ' + start));
  for (const [start, end] of [[9, 12], [12.5, 13], [14.35, 15.05]]) {
    const sound = sounds[expected.indexOf(start)];
    assert.ok(Math.abs(sound.end - end) < 0.04, 'Unexpected flatline end at ' + sound.end);
  }
}

(async () => {
  const browser = await launchBrowser();
  try {
    await checkClock(browser);
    await checkWaveform(browser);
    console.log('监护音通过：心率实时时序、快进与留观、室颤三短声、心静止持续音、多床优先级、暂停与静音。');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
