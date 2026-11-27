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
    const game = window.__LIFE_GAME;
    const { S, beds, E } = game;
    // Hold physiology steady while the normal ward loop advances the game clock.
    E.tick = (s, dt) => { s.t += dt; };
    CASEGEN.step = () => {};
    const stableVitals = { rhythm: 'sinus', spo2: 99, rr: 15, gcs: 15, k: 4, glu: 5,
      ph: 7.4, vent: 0, temp: 37, sv: 90, svr: 18, cvp: 4, opioidTox: true };
    Object.assign(S, stableVitals, { hr: 60, t: 0, tests: {} });
    const other = Object.assign(E.create('bleed'), stableVitals, { hr: 75, spo2: 75 });
    const patients = [S, other];
    let clock = 0;
    const beats = [], alarms = [], flatlines = [], warnings = [];
    const tracks = new Map();
    SOUND.beat = () => beats.push(clock);
    SOUND.alarm = (patient, bed) => {
      alarms.push([clock, patients.indexOf(patient), bed]);
      tracks.set(patient, 'vf');
    };
    SOUND.critical = (patient, bed) => warnings.push([clock, patients.indexOf(patient), bed]);
    SOUND.flatline = (patient, bed) => {
      flatlines.push([clock, patients.indexOf(patient), bed]);
      tracks.set(patient, 'asystole');
    };
    SOUND.stopMonitorAlarm = patient => {
      if (patient === undefined) tracks.clear();
      else tracks.delete(patient);
    };
    Object.defineProperty(SOUND, 'flatlinePlaying', { value: patient => tracks.get(patient) === 'asystole' });
    function run(ms) {
      const end = clock + ms;
      while (clock < end) { clock += 10; window.wardFrame(clock); }
    }
    function alarmState() {
      return patients.map(patient => tracks.get(patient) ?? null);
    }
    function beatTimes(since) {
      return beats.filter(time => time > since).map(time => time - since);
    }
    function switchBed(index) {
      document.querySelector('#btnLobby').click();
      document.querySelector(`#lobby [data-bed="${index}"]`).click();
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
    const fastBeats = beatTimes(10000);
    // A bed already flagged for a low SpO₂ can still develop VF.
    beds.push({ S: other });
    run(10);
    const bothSinusAt = clock;
    run(2000);
    const bothSinusBeats = beatTimes(bothSinusAt);
    const backgroundWarning = warnings.some(([, patient, bed]) => patient === 1 && bed === 1);
    warnings.length = 0;
    other.rhythm = 'vf';
    S.rhythm = 'vf';
    S._wasSevere = false;
    S._ready = true;
    const arrestAt = clock;
    run(2000);
    S.rhythm = 'asystole';
    run(2000);
    switchBed(1);
    run(1000);
    const switched = alarmState();
    const arrestWarnings = warnings.slice();

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
    const arrestBeats = beatTimes(arrestAt);

    S.rhythm = 'sinus';
    switchBed(0);
    const firstRecoveryAt = clock;
    run(1700);
    const firstRecovery = alarmState();
    const firstRecoveryBeats = beatTimes(firstRecoveryAt);

    S.rhythm = 'asystole';
    run(10);
    switchBed(1);
    E.endCase(S, 'death', '监护音回归测试');
    run(1600);
    const removed = game.beds.length === 1 && game.beds[0].S === other;
    const afterRemoval = alarmState();
    other.rhythm = 'sinus';
    other.spo2 = 99;
    const finalRecoveryAt = clock;
    run(1600);

    function alarmTimes(events) {
      return events.map(([time, patient, bed]) => [time - arrestAt, patient, bed])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    }
    return { slowBeats, fastBeats, observing, bothSinusBeats, backgroundWarning, arrestBeats, arrestWarnings,
      vfTimes: alarmTimes(alarms), flatlineTimes: alarmTimes(flatlines),
      switched, paused, resumed, muted, unmuted, firstRecovery, firstRecoveryBeats, removed, afterRemoval,
      finalRecovery: alarmState(), finalRecoveryBeats: beatTimes(finalRecoveryAt) };
  });
  await page.close();
  assert.ok(result.observing);
  assert.deepEqual(result.slowBeats, Array.from({ length: 10 }, (_, i) => 10 + 1000 * i));
  assert.ok(result.fastBeats.length === 4 && result.fastBeats.slice(1).every((t, i) => t - result.fastBeats[i] === 500));
  assert.deepEqual(result.bothSinusBeats, [500, 1000, 1500, 2000]);
  assert.ok(result.backgroundWarning);
  assert.deepEqual(result.arrestBeats, []);
  assert.deepEqual(result.arrestWarnings, []);
  assert.deepEqual(result.vfTimes, [[10, 0, 0], [10, 1, 1], [1510, 0, 0], [1510, 1, 1],
    [3010, 1, 1], [4510, 1, 1], [7010, 1, 1], [9020, 1, 1], [10520, 1, 1], [12020, 1, undefined]]);
  assert.deepEqual(result.flatlineTimes, [[2010, 0, 0], [7010, 0, 0], [9020, 0, 0], [10730, 0, 0]]);
  assert.deepEqual(result.switched, ['asystole', 'vf']);
  assert.deepEqual(result.paused, [null, null]);
  assert.deepEqual(result.resumed, ['asystole', 'vf']);
  assert.deepEqual(result.muted, [null, null]);
  assert.deepEqual(result.unmuted, ['asystole', 'vf']);
  assert.deepEqual(result.firstRecovery, [null, 'vf']);
  assert.deepEqual(result.firstRecoveryBeats, [10, 510, 1010, 1510]);
  assert.ok(result.removed);
  assert.deepEqual(result.afterRemoval, [null, 'vf']);
  assert.deepEqual(result.finalRecovery, [null, null]);
  assert.deepEqual(result.finalRecoveryBeats, [10, 810]);
}

async function checkWaveform(browser) {
  const page = await browser.newPage();
  await page.evaluate(() => {
    window.offline = new OfflineAudioContext(1, 18 * 48000, 48000);
    window.AudioContext = function () { return window.offline; };
  });
  await page.addScriptTag({ path: path.resolve(__dirname, '../prototype/sound.js') });
  const result = await page.evaluate(async () => {
    const first = {}, second = {};
    SOUND.beat();
    const cues = [[0.75, 'beat'], [1.5, 'beat'], [2.25, 'beat'], [3, 'critical'],
      [4.5, 'alarm'], [6, 'alarm'], [7.5, 'beat'],
      [8, 'critical'], [8.2, 'alarm'], [8.55, 'stopMonitorAlarm'],
      [9, 'flatline'], [10, 'flatline'], [11, 'critical'], [12, 'stopMonitorAlarm'],
      [12.5, 'flatline'], [13, 'mute'], [13.5, 'unmute'],
      [14, 'alarm'], [14.35, 'flatline'], [15.05, 'stopMonitorAlarm'], [15.5, 'beat'],
      [16, 'flatline'], [16.25, 'alarm', second, 1], [16.38, 'stopMonitorAlarm'],
      [17.1, 'flatline'], [17.3, 'alarm', second, 1], [17.4, 'stopAll']];
    const events = cues.map(([time, id, patient = first, bed = 0]) => offline.suspend(time).then(() => {
      if (id === 'mute' || id === 'unmute') SOUND.enabled = id === 'unmute';
      else if (id === 'stopAll') SOUND.stopMonitorAlarm();
      else SOUND[id](patient, bed);
      return offline.resume();
    }));
    const buffer = await offline.startRendering();
    await Promise.all(events);
    const samples = buffer.getChannelData(0), sounds = [];
    let sounding = false;
    for (let i = 0; i < samples.length; i += 480) {
      let energy = 0;
      for (const value of samples.subarray(i, i + 480)) energy += value * value;
      // Detect the quiet fade-in as well as the louder alarm pulses.
      const on = Math.sqrt(energy / 480) > 0.001;
      if (on && !sounding) sounds.push({ start: i / buffer.sampleRate });
      if (!on && sounding) sounds.at(-1).end = i / buffer.sampleRate;
      sounding = on;
    }

    // Compare each tone's spectrum in isolation and while both beds are sounding.
    function magnitude(time, frequency) {
      const start = Math.round(time * buffer.sampleRate);
      const length = Math.round(0.04 * buffer.sampleRate);
      const phase = 2 * Math.PI * frequency / buffer.sampleRate;
      let real = 0, imaginary = 0;
      for (let i = 0; i < length; i++) {
        const sample = samples[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / length));
        real += sample * Math.cos(phase * i);
        imaginary += sample * Math.sin(phase * i);
      }
      return 2 * Math.hypot(real, imaginary) / length;
    }
    function peakAt(time) {
      let peak = { frequency: 0, level: 0 };
      for (let frequency = 300; frequency <= 1400; frequency += 5) {
        const level = magnitude(time, frequency);
        if (level > peak.level) peak = { frequency, level };
      }
      return peak;
    }
    const flatline = peakAt(16.12);
    const vf = peakAt(16.47);
    return { sounds, flatline, vf, mixedFlatline: magnitude(16.27, flatline.frequency),
      mixedVf: magnitude(16.27, vf.frequency), stoppedFlatline: magnitude(16.47, flatline.frequency) };
  });
  await page.close();
  const { sounds, flatline, vf, mixedFlatline, mixedVf, stoppedFlatline } = result;
  const expected = [0, 0.75, 1.5, 2.25, 3, 3.27, 4.5, 4.7, 4.9, 6, 6.2, 6.4, 7.5, 8, 8.2, 8.4,
    9, 12.5, 14, 14.2, 14.35, 15.5, 16, 16.45, 16.65, 17.1];
  assert.equal(sounds.length, expected.length);
  sounds.forEach(({ start }, i) => assert.ok(Math.abs(start - expected[i]) < 0.025, 'Unexpected sound at ' + start));
  for (const [start, end] of [[9, 12], [12.5, 13], [14.35, 15.05], [16, 16.38], [17.1, 17.4]]) {
    const sound = sounds[expected.indexOf(start)];
    assert.ok(Math.abs(sound.end - end) < 0.04, 'Unexpected flatline end at ' + sound.end);
  }
  assert.ok(flatline.level > 0.002 && vf.level > 0.002, 'Expected both beds to produce audible tones');
  assert.ok(Math.abs(flatline.frequency - vf.frequency) > 60, 'Expected distinct VF and flatline tones');
  assert.ok(mixedFlatline > flatline.level / 3, 'Flatline tone missing during VF alert');
  assert.ok(mixedVf > vf.level / 3, 'VF tone missing during flatline alert');
  assert.ok(stoppedFlatline < flatline.level / 8, 'Stopped flatline tone still audible during VF alert');
}

(async () => {
  const browser = await launchBrowser();
  try {
    await checkClock(browser);
    await checkWaveform(browser);
    console.log('监护音通过：心率实时时序、快进与留观、室颤三短声、心静止持续音、多床同时报警、暂停与静音。');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
