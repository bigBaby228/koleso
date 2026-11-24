/*
 * Звук «Колеса»: всё синтезируется в браузере (Web Audio), без файлов.
 * KolesoSound.play('dice' | 'coin' | 'buy' | 'bad' | 'win' | 'tap' | 'step' | 'card' | 'alert' | 'bid')
 * KolesoSound.setVolume(sfx 0..1, music 0..1), KolesoSound.music(true/false)
 * Браузеры разрешают звук только после касания экрана — контекст создаётся при первом касании.
 */
(function (root) {
  'use strict';
  let ctx = null, master = null, sfxGain = null, musicGain = null, noiseBuf = null;
  let vol = { sfx: 0.7, music: 0.35 }, wantMusic = false, musicTimer = null, nextBar = 0, bar = 0;

  function init() {
    if (ctx) return ctx;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    applyVol();
    return ctx;
  }
  function applyVol() {
    if (!ctx) return;
    sfxGain.gain.setTargetAtTime(vol.sfx * 0.8, ctx.currentTime, 0.02);
    musicGain.gain.setTargetAtTime(vol.music * 0.22, ctx.currentTime, 0.2);
  }
  // первое касание открывает звук (требование iOS и Chrome)
  // iOS: без этого Web Audio молчит при беззвучном режиме и в WebView Telegram
  try { if (root.navigator && root.navigator.audioSession) root.navigator.audioSession.type = 'playback'; } catch (e) { /* старые браузеры */ }
  let primed = false;
  function unlock() {
    if (!init()) return;
    if (ctx.state !== 'running') { const r = ctx.resume(); if (r && r.then) r.then(() => { if (wantMusic) startMusic(); }, () => {}); }
    if (!primed) { // iOS открывает звук только после реально проигранного буфера внутри касания
      try { const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(0); primed = true; } catch (e) { /* ignore */ }
    }
    if (wantMusic) startMusic();
  }
  // touchstart в iOS не считается «жестом пользователя» — ловим и touchend/click
  ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'].forEach(ev => root.addEventListener && root.addEventListener(ev, unlock, { passive: true, capture: true }));
  if (root.document) root.document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else { ctx.resume(); primed = false; if (wantMusic) startMusic(); }
  });

  /* ---------- кирпичики ---------- */
  function tone(t, f, dur, o) {
    o = o || {};
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const a = o.attack || 0.005, peak = o.gain || 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) { const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = o.lp; node.connect(f2); node = f2; }
    node.connect(g); g.connect(o.dest || sfxGain);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(t, dur, o) {
    o = o || {};
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noiseBuf; src.playbackRate.value = o.rate || 1;
    f.type = o.ft || 'bandpass'; f.frequency.setValueAtTime(o.f || 2000, t); f.Q.value = o.q || 1;
    if (o.fTo) f.frequency.exponentialRampToValueAtTime(o.fTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.gain || 0.3, t + (o.attack || 0.003)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxGain);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  /* ---------- звуки событий ---------- */
  const SFX = {
    tap: t => tone(t, 880, 0.05, { type: 'triangle', gain: 0.08 }),
    step: t => tone(t, 520 + Math.random() * 60, 0.06, { type: 'sine', gain: 0.07 }),
    // кубик: несколько ударов о сукно и финальный стук
    dice: t => {
      for (let i = 0; i < 6; i++) noise(t + i * 0.06 + Math.random() * 0.03, 0.05, { f: 1800 + Math.random() * 1500, q: 3, gain: 0.22 });
      noise(t + 0.42, 0.09, { f: 700, q: 2, gain: 0.35 }); tone(t + 0.42, 140, 0.12, { gain: 0.2 });
    },
    // монеты: два звонких «дзынь»
    coin: t => { [0, 0.07].forEach((d, i) => { tone(t + d, i ? 1760 : 1320, 0.35, { type: 'triangle', gain: 0.14 }); tone(t + d, (i ? 1760 : 1320) * 2.01, 0.2, { gain: 0.05 }); }); },
    // покупка: короткое восходящее арпеджио
    buy: t => [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.06, f, 0.22, { type: 'triangle', gain: 0.12 })),
    // неприятность: глухой нисходящий удар
    bad: t => { tone(t, 220, 0.45, { type: 'sawtooth', to: 70, gain: 0.16, lp: 600 }); noise(t, 0.25, { ft: 'lowpass', f: 400, gain: 0.2 }); },
    // победа: фанфара и блеск
    win: t => {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(t + i * 0.09, f, 0.5, { type: 'triangle', gain: 0.13 }));
      [784, 988, 1175].forEach(f => tone(t + 0.5, f, 1.2, { type: 'sine', gain: 0.08, attack: 0.03 }));
      for (let i = 0; i < 8; i++) tone(t + 0.55 + i * 0.05, 2000 + Math.random() * 1500, 0.15, { gain: 0.03 });
    },
    // карточка выезжает
    card: t => noise(t, 0.18, { ft: 'bandpass', f: 900, fTo: 3200, q: 0.8, gain: 0.07 }),
    // тревога: удар по конкуренту, финишная прямая
    alert: t => { tone(t, 988, 0.12, { type: 'square', gain: 0.06, lp: 2500 }); tone(t + 0.16, 784, 0.18, { type: 'square', gain: 0.06, lp: 2500 }); },
    // ставка на торгах: молоточек
    bid: t => { noise(t, 0.06, { f: 1200, q: 4, gain: 0.3 }); tone(t, 330, 0.12, { gain: 0.15 }); },
    // новый круг: широкий аккорд
    level: t => [392, 494, 587, 784].forEach((f, i) => tone(t + i * 0.03, f, 1.4, { type: 'triangle', gain: 0.08, attack: 0.08 })),
  };
  function play(name) {
    if (!vol.sfx || !SFX[name]) return;
    if (!init()) return;
    if (ctx.state !== 'running') { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); if (ctx.state !== 'running') return; }
    try { SFX[name](ctx.currentTime + 0.01); } catch (e) { /* звук — не критично */ }
  }

  /* ---------- фоновая музыка: спокойный лаунж ---------- */
  // аккорды по 2 такта: Am9 — D9 — Gmaj9 — Cmaj9 — Fmaj7 — E7(b9)
  const PROG = [[57, 60, 64, 67, 71], [50, 57, 60, 64, 66], [55, 59, 62, 66, 69], [48, 55, 59, 62, 64], [53, 57, 60, 64], [52, 56, 59, 62, 65]];
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  const BEAT = 60 / 76;
  function epiano(t, m, dur, g) { // мягкое электропиано: синус + лёгкая октава
    tone(t, hz(m), dur, { type: 'sine', gain: g, attack: 0.02, dest: musicGain });
    tone(t, hz(m) * 2, dur * 0.6, { type: 'sine', gain: g * 0.18, attack: 0.01, dest: musicGain });
  }
  function scheduleBar(t) {
    const ch = PROG[Math.floor(bar / 2) % PROG.length];
    const second = bar % 2 === 1;
    // бас: корень и квинта
    tone(t, hz(ch[0] - 12), BEAT * 1.8, { type: 'triangle', gain: 0.22, attack: 0.02, lp: 400, dest: musicGain });
    tone(t + BEAT * 2, hz(ch[0] - 5), BEAT * 1.6, { type: 'triangle', gain: 0.16, attack: 0.02, lp: 400, dest: musicGain });
    // аккорд: на первом такте — целиком, на втором — синкопа
    ch.slice(1).forEach((m, i) => epiano(t + (second ? BEAT * 1.5 : 0) + i * 0.012, m, BEAT * 2.6, 0.045));
    // мелодические «капли»
    if (Math.random() < 0.6) { const m = ch[1 + Math.floor(Math.random() * (ch.length - 1))] + 12; epiano(t + BEAT * (2.5 + Math.floor(Math.random() * 2) * 0.5), m, BEAT * 1.2, 0.03); }
    // щёточки
    for (let b = 0; b < 4; b++) noise(t + b * BEAT + BEAT / 2, 0.08, { ft: 'highpass', f: 6000, gain: 0.025, dest: musicGain });
    bar++;
  }
  function tick() {
    if (!ctx || !wantMusic || !vol.music) return;
    while (nextBar < ctx.currentTime + 1.2) { scheduleBar(nextBar); nextBar += BEAT * 4; }
  }
  function startMusic() {
    if (!init() || ctx.state !== 'running' || musicTimer || !vol.music) return;
    nextBar = ctx.currentTime + 0.1;
    musicTimer = setInterval(tick, 300); tick();
  }
  function stopMusic() { clearInterval(musicTimer); musicTimer = null; }

  const KolesoSound = {
    play,
    setVolume(sfx, music) {
      vol.sfx = Math.max(0, Math.min(1, +sfx || 0)); vol.music = Math.max(0, Math.min(1, +music || 0));
      applyVol();
      if (!vol.music) stopMusic(); else if (wantMusic) startMusic();
    },
    music(on) { wantMusic = !!on; if (wantMusic) startMusic(); else stopMusic(); },
  };
  root.KolesoSound = KolesoSound;
})(typeof window !== 'undefined' ? window : this);
