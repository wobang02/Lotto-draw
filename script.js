/* 숫자 구슬 추첨
 * - 외부 라이브러리 없이 순수 JavaScript로 만들었습니다.
 * - 설정(숫자 범위, 개수, 방식, 소리)은 이 브라우저의 localStorage에만 저장합니다.
 * - 어떤 데이터도 외부로 보내지 않습니다.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    minInput: $('minInput'),
    maxInput: $('maxInput'),
    countInput: $('countInput'),
    countMinus: $('countMinus'),
    countPlus: $('countPlus'),
    drawBtn: $('drawBtn'),
    resetBtn: $('resetBtn'),
    message: $('message'),
    status: $('status'),
    slots: $('slots'),
    reveal: $('reveal'),
    canvas: $('machineCanvas'),
    machine: $('machine'),
    soundBtn: $('soundBtn'),
    fullBtn: $('fullBtn'),
    confetti: $('confetti'),
    modeBtns: Array.from(document.querySelectorAll('[data-mode]')),
    speedBtns: Array.from(document.querySelectorAll('[data-speed]')),
    dim: $('dim'),
    dimCaption: $('dimCaption'),
  };

  const LIMITS = { minNum: 0, maxNum: 999, maxCount: 30 };
  const STORAGE_KEY = 'numberBallDraw.settings.v1';
  const MAX_VISIBLE_BALLS = 120; // 숫자가 아주 많으면 추첨기에는 120개만 그립니다.
  const FONT = '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif';
  const IDLE_STATUS = '설정을 확인하고 추첨 시작을 누르세요';

  // 구슬 색: [밝은 색, 어두운 색]. 10단위로 색이 바뀝니다.
  const PALETTE = [
    ['#f7c948', '#c99a14'],
    ['#4a90e2', '#2a5d9f'],
    ['#ef5b5b', '#b02f2f'],
    ['#3dbb7f', '#23824f'],
    ['#9b6dd6', '#6a3fa6'],
    ['#f28c38', '#b85e12'],
  ];
  const colorFor = (n) => PALETTE[Math.floor(Math.max(n - 1, 0) / 10) % PALETTE.length];

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 애니메이션 시간 조절: '빠르게'를 고르면 절반, 움직임 줄이기 설정이면 더 짧게
  const T = (ms) => Math.round(ms * (settings.speed === 'fast' ? 0.5 : 1) * (reduceMotion ? 0.35 : 1));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // 공정한 무작위: 0 이상 n 미만의 정수
  function randInt(n) {
    const limit = Math.floor(0x100000000 / n) * n;
    const buf = new Uint32Array(1);
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % n;
  }

  /* ---------------- 설정 저장/불러오기 ---------------- */
  const DEFAULTS = { min: 1, max: 28, count: 6, mode: 'auto', speed: 'normal', sound: true };

  function loadSettings() {
    const s = { ...DEFAULTS };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (Number.isInteger(saved.min)) s.min = saved.min;
        if (Number.isInteger(saved.max)) s.max = saved.max;
        if (Number.isInteger(saved.count)) s.count = saved.count;
        if (saved.mode === 'auto' || saved.mode === 'one') s.mode = saved.mode;
        if (saved.speed === 'normal' || saved.speed === 'fast') s.speed = saved.speed;
        if (typeof saved.sound === 'boolean') s.sound = saved.sound;
      }
    } catch (e) { /* 저장소를 못 쓰는 환경이면 기본값 사용 */ }
    if (validate(s)) return { ...DEFAULTS, mode: s.mode, speed: s.speed, sound: s.sound };
    return s;
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* 무시 */ }
  }

  /* ---------------- 입력 검사 ---------------- */
  function toInt(v) {
    if (String(v).trim() === '') return NaN;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : NaN;
  }

  function readInputs() {
    return {
      min: toInt(els.minInput.value),
      max: toInt(els.maxInput.value),
      count: toInt(els.countInput.value),
    };
  }

  function validate({ min, max, count }) {
    if (Number.isNaN(min) || Number.isNaN(max)) return '시작 숫자와 끝 숫자를 모두 입력해 주세요.';
    if (min < LIMITS.minNum || max < LIMITS.minNum || min > LIMITS.maxNum || max > LIMITS.maxNum) {
      return `숫자는 ${LIMITS.minNum}부터 ${LIMITS.maxNum}까지 쓸 수 있어요.`;
    }
    if (min >= max) return '끝 숫자는 시작 숫자보다 커야 해요.';
    if (Number.isNaN(count) || count < 1) return '뽑을 개수는 1개 이상이어야 해요.';
    if (count > LIMITS.maxCount) return `한 번에 ${LIMITS.maxCount}개까지 뽑을 수 있어요.`;
    const size = max - min + 1;
    if (count > size) return `${min}부터 ${max}까지는 숫자가 ${size}개라서 ${size}개까지만 뽑을 수 있어요.`;
    return '';
  }

  /* ---------------- 상태 ---------------- */
  const settings = loadSettings();
  const state = {
    phase: 'idle', // idle: 시작 전, drawing: 뽑는 중, done: 끝
    busy: false,   // 구슬이 움직이는 중이면 true (버튼 잠금)
    pool: [],
    picked: [],
  };

  /* ---------------- 소리 (Web Audio API로 직접 만듦) ---------------- */
  const sound = (() => {
    let ac = null;
    let clickBuf = null;
    let longNoise = null;

    function unlock() {
      if (!settings.sound) return;
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
      }
      if (ac.state === 'suspended') ac.resume();
    }
    const ready = () => settings.sound && ac;

    function tone(freq, start, dur, type, vol, freqEnd) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, start);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, start + dur);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(vol, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      o.connect(g).connect(ac.destination);
      o.start(start);
      o.stop(start + dur + 0.05);
    }

    // 짧은 '딸깍' 소리 (구슬 부딪힘, 북소리에 사용)
    function click(start, freq, gain = 0.6) {
      if (!clickBuf) {
        clickBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.04), ac.sampleRate);
        const d = clickBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
      }
      const src = ac.createBufferSource();
      src.buffer = clickBuf;
      const f = ac.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = 5;
      const g = ac.createGain();
      g.gain.value = gain;
      src.connect(f).connect(g).connect(ac.destination);
      src.start(start);
    }

    function noiseLoop() {
      if (!longNoise) {
        longNoise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
        const d = longNoise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const src = ac.createBufferSource();
      src.buffer = longNoise;
      src.loop = true;
      return src;
    }

    return {
      unlock,
      // 구슬이 섞이는 소리
      rattle(sec) {
        if (!ready()) return;
        const t = ac.currentTime;
        const n = Math.floor(sec * 26);
        for (let i = 0; i < n; i++) {
          const p = Math.sqrt(Math.random()); // 뒤로 갈수록 촘촘하게
          click(t + p * sec, 1600 + Math.random() * 2600, 0.3 + p * 0.5);
        }
      },
      // 바람 소리가 점점 커짐
      whoosh(sec) {
        if (!ready()) return;
        const t = ac.currentTime;
        const src = noiseLoop();
        const f = ac.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 1.2;
        f.frequency.setValueAtTime(300, t);
        f.frequency.exponentialRampToValueAtTime(2200, t + sec);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.22, t + sec * 0.9);
        g.gain.exponentialRampToValueAtTime(0.0001, t + sec + 0.3);
        src.connect(f).connect(g).connect(ac.destination);
        src.start(t);
        src.stop(t + sec + 0.4);
      },
      // 빨려 올라가는 소리
      suck() {
        if (!ready()) return;
        tone(220, ac.currentTime, 0.45, 'sine', 0.22, 880);
      },
      // 관을 타고 구르는 소리 (점점 빨라짐)
      roll(sec) {
        if (!ready()) return;
        const t = ac.currentTime;
        const n = Math.floor(sec * 30);
        for (let i = 0; i < n; i++) click(t + sec * Math.sqrt(i / n), 900 + Math.random() * 600, 0.35);
      },
      // 컵에 '탁' 떨어지는 소리
      clack() {
        if (!ready()) return;
        const t = ac.currentTime;
        click(t, 700, 1.2);
        click(t + 0.12, 900, 0.6);
        click(t + 0.2, 1000, 0.3);
        tone(170, t, 0.14, 'triangle', 0.28);
      },
      // 두구두구 북소리
      drumroll(sec) {
        if (!ready()) return;
        const t = ac.currentTime;
        const n = Math.floor(sec * 26);
        for (let i = 0; i < n; i++) click(t + (i / n) * sec, 220 + Math.random() * 80, 0.6 + (i / n) * 1.6);
      },
      // 숫자 공개
      reveal() {
        if (!ready()) return;
        const t = ac.currentTime;
        [784, 988, 1175, 1568].forEach((f, i) => tone(f, t + i * 0.06, 0.5, 'triangle', 0.16));
        tone(2093, t + 0.25, 0.7, 'sine', 0.06);
      },
      ding() {
        if (!ready()) return;
        const t = ac.currentTime;
        tone(1046, t, 0.4, 'triangle', 0.12);
      },
      fanfare() {
        if (!ready()) return;
        const t = ac.currentTime;
        [523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.13, i === 3 ? 0.8 : 0.28, 'triangle', 0.2));
      },
    };
  })();

  /* ---------------- 추첨기 (캔버스에 직접 그림) ---------------- */
  const machine = (() => {
    const cv = els.canvas;
    const ctx = cv.getContext('2d');
    let W = 0, H = 0, cx = 0, cy = 0, R = 0;
    let balls = [];
    let traveler = null; // 뽑혀서 관을 지나가는 구슬
    let last = 0;
    const mix = { level: 0, from: 0, to: 0, t0: 0, dur: 1 };

    // 구슬이 지나가는 길. 유리구 반지름(R)을 1로 본 좌표입니다.
    const PATH = (() => {
      const pts = [[0, -0.62]];
      const line = (a, b, n) => {
        for (let i = 1; i <= n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]);
      };
      const curve = (p0, p1, p2, p3, n) => {
        for (let i = 1; i <= n; i++) {
          const t = i / n, u = 1 - t;
          pts.push([
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
          ]);
        }
      };
      line([0, -0.62], [0, -0.98], 8);           // 유리구 안에서 위로 빨려 올라감
      const tubeStart = pts.length - 1;
      curve([0, -0.98], [0, -1.2], [0.32, -1.2], [0.5, -1.15], 16);
      curve([0.5, -1.15], [1.0, -1.02], [1.35, -0.82], [1.35, -0.3], 22);
      line([1.35, -0.3], [1.35, 0.3], 10);       // 관을 따라 아래로
      const tubeEnd = pts.length - 1;
      line([1.35, 0.3], [1.35, 0.86], 10);       // 관 밖으로 떨어짐
      const len = [0];
      for (let i = 1; i < pts.length; i++) {
        len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      }
      return { pts, len, total: len[len.length - 1], tubeStart, tubeEnd };
    })();

    function pathAt(u) {
      const L = Math.max(0, Math.min(1, u)) * PATH.total;
      let i = 1;
      while (i < PATH.len.length - 1 && PATH.len[i] < L) i++;
      const a = PATH.pts[i - 1], b = PATH.pts[i];
      const seg = PATH.len[i] - PATH.len[i - 1] || 1;
      const f = (L - PATH.len[i - 1]) / seg;
      return [cx + (a[0] + (b[0] - a[0]) * f) * R, cy + (a[1] + (b[1] - a[1]) * f) * R];
    }

    function geometry() {
      const s = Math.max(10, Math.min(W / 1.18, H / 1.18));
      R = s * 0.45;
      cx = (W - 2.5 * R) / 2 + R;
      cy = (H - 2.55 * R) / 2 + 1.3 * R;
    }

    function resize() {
      const rect = cv.getBoundingClientRect();
      const oldR = R, ocx = cx, ocy = cy;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      cv.width = Math.max(1, Math.round(W * dpr));
      cv.height = Math.max(1, Math.round(H * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      geometry();
      if (oldR > 0) {
        const k = R / oldR;
        for (const b of balls) {
          b.x = cx + (b.x - ocx) * k;
          b.y = cy + (b.y - ocy) * k;
          b.r *= k;
        }
        if (traveler) {
          traveler.fromX = cx + (traveler.fromX - ocx) * k;
          traveler.fromY = cy + (traveler.fromY - ocy) * k;
          traveler.r0 *= k;
        }
      }
    }

    function fill(nums) {
      const labeled = nums.length <= MAX_VISIBLE_BALLS;
      const n = labeled ? nums.length : MAX_VISIBLE_BALLS;
      const r = Math.min(R * 0.15, R * Math.sqrt(0.36 / n));
      balls = [];
      traveler = null;
      for (let i = 0; i < n; i++) {
        const num = labeled ? nums[i] : null;
        const ang = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * (R * 0.9 - r);
        balls.push({
          x: cx + Math.cos(ang) * d,
          y: cy + Math.abs(Math.sin(ang)) * d,
          vx: 0, vy: 0, r, num,
          color: labeled ? colorFor(num) : PALETTE[i % PALETTE.length],
        });
      }
    }

    // 섞는 세기를 dur 동안 target까지 서서히 바꿈 (0: 멈춤, 1: 보통, 1.7: 아주 세게)
    function mixTo(target, dur) {
      mix.from = mix.level;
      mix.to = target;
      mix.t0 = performance.now();
      mix.dur = Math.max(1, dur);
    }

    // 구슬 하나를 빨아올려 관으로 내보냄. 컵에 떨어지면 화면 좌표를 돌려줌
    function launch(num, opts) {
      return new Promise((resolve) => {
        let b = null;
        if (balls.length) {
          let i = balls.findIndex((x) => x.num === num);
          if (i < 0) i = Math.floor(Math.random() * balls.length);
          b = balls.splice(i, 1)[0];
        } else {
          b = { x: cx, y: cy + R * 0.6, r: R * 0.08 };
        }
        traveler = {
          x: b.x, y: b.y, r: b.r,
          fromX: b.x, fromY: b.y, r0: b.r,
          color: colorFor(num),
          stage: 'capture', t0: performance.now(), glow: 0,
          opts, resolve,
        };
        if (opts.onCapture) opts.onCapture();
      });
    }

    function updateTraveler(now) {
      const tr = traveler;
      if (!tr) return;
      const o = tr.opts;
      const rT = R * 0.1;
      if (tr.stage === 'capture') {
        const k = Math.min(1, (now - tr.t0) / o.capture);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const [sx, sy] = pathAt(0);
        tr.x = tr.fromX + (sx - tr.fromX) * e;
        tr.y = tr.fromY + (sy - tr.fromY) * e;
        tr.r = tr.r0 + (rT - tr.r0) * e;
        tr.glow = k;
        if (k >= 1) {
          tr.stage = 'travel';
          tr.t0 = now;
          if (o.onTravel) o.onTravel();
        }
      } else if (tr.stage === 'travel') {
        const k = Math.min(1, (now - tr.t0) / o.travel);
        [tr.x, tr.y] = pathAt(Math.pow(k, 1.8)); // 처음엔 천천히, 갈수록 빠르게
        tr.r = rT;
        if (k >= 1) {
          tr.stage = 'land';
          tr.t0 = now;
          if (o.onLand) o.onLand();
        }
      } else if (tr.stage === 'land') {
        const k = Math.min(1, (now - tr.t0) / o.land);
        const [ex, ey] = pathAt(1);
        tr.x = ex;
        tr.y = ey - Math.abs(Math.sin(k * Math.PI * 3)) * (1 - k) * R * 0.16; // 통통 튀기
        tr.r = rT;
        if (k >= 1) {
          tr.stage = 'rest';
          tr.y = ey;
          const res = tr.resolve;
          tr.resolve = null;
          if (res) {
            const p = toPage(ex, ey);
            res({ x: p.x, y: p.y, r: rT });
          }
        }
      }
    }

    function step(dt) {
      const lvl = mix.level;
      const g = R * 3.2;
      const maxV = R * 6.5;
      const wall = R * 0.95;
      for (const b of balls) {
        b.vy += g * dt;
        if (lvl > 0.01) {
          // 바닥에서 바람이 불어 올라오는 느낌
          if (b.y > cy + R * 0.15) {
            b.vy -= (R * 9 + Math.random() * R * 9) * lvl * dt;
            b.vx += (Math.random() - 0.5) * R * 16 * lvl * dt;
          }
          b.vx += (Math.random() - 0.5) * R * 4 * lvl * dt;
        }
        b.vx *= 0.996;
        b.vy *= 0.996;
        const sp = Math.hypot(b.vx, b.vy);
        if (sp > maxV) { b.vx *= maxV / sp; b.vy *= maxV / sp; }
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        const dx = b.x - cx, dy = b.y - cy;
        const d = Math.hypot(dx, dy) || 0.0001;
        const lim = wall - b.r;
        if (d > lim) {
          const nx = dx / d, ny = dy / d;
          b.x = cx + nx * lim;
          b.y = cy + ny * lim;
          const vn = b.vx * nx + b.vy * ny;
          if (vn > 0) { b.vx -= 1.55 * vn * nx; b.vy -= 1.55 * vn * ny; }
          b.vx *= 0.985;
          b.vy *= 0.985;
        }
      }
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const min = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          const push = (min - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (vn < 0) {
            const imp = -0.75 * vn;
            a.vx -= imp * nx; a.vy -= imp * ny;
            b.vx += imp * nx; b.vy += imp * ny;
          }
        }
      }
    }

    function circle(x, y, r) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }

    function drawBall(b, showNumber) {
      const [c, cd] = b.color;
      const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.05, b.x, b.y, b.r);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.2, c);
      g.addColorStop(1, cd);
      ctx.fillStyle = g;
      circle(b.x, b.y, b.r);
      ctx.fill();
      if (showNumber && b.num !== null && b.r >= 9) {
        ctx.fillStyle = '#ffffff';
        circle(b.x, b.y, b.r * 0.6);
        ctx.fill();
      }
      if (showNumber && b.num !== null && b.r >= 9) {
        ctx.fillStyle = '#111111';
        ctx.font = `800 ${b.r * (b.num >= 100 ? 0.5 : 0.7)}px ${FONT}`;
        ctx.fillText(String(b.num), b.x, b.y + b.r * 0.05);
      }
    }

    function tubePath(dx = 0, dy = 0) {
      ctx.beginPath();
      for (let i = PATH.tubeStart; i <= PATH.tubeEnd; i++) {
        const x = cx + PATH.pts[i][0] * R + dx, y = cy + PATH.pts[i][1] * R + dy;
        if (i === PATH.tubeStart) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }

    function render() {
      ctx.setTransform(Math.min(window.devicePixelRatio || 1, 2), 0, 0, Math.min(window.devicePixelRatio || 1, 2), 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (R <= 0) return;

      // 아주 세게 섞을 때는 추첨기가 덜덜 흔들림
      const shake = Math.max(0, mix.level - 0.9) * R * 0.018;
      if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

      const [cupX, cupY] = [cx + 1.35 * R, cy + 0.86 * R];
      const floorY = cy + 1.24 * R;

      // 받침대
      const bg = ctx.createLinearGradient(0, cy + R, 0, floorY);
      bg.addColorStop(0, '#b9c9da');
      bg.addColorStop(1, '#8094aa');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.moveTo(cx - R * 0.22, cy + R);
      ctx.lineTo(cx + R * 0.22, cy + R);
      ctx.lineTo(cx + R * 0.62, floorY);
      ctx.lineTo(cx - R * 0.62, floorY);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#9fb2c6';
      ctx.fillRect(cx - R * 0.16, cy + R * 0.86, R * 0.32, R * 0.16);

      // 컵 기둥
      ctx.fillStyle = '#9fb2c6';
      ctx.fillRect(cupX - R * 0.03, cupY + R * 0.12, R * 0.06, floorY - cupY - R * 0.12);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.ellipse(cupX, floorY - R * 0.02, R * 0.2, R * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();

      // 유리 구
      const glass = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
      glass.addColorStop(0, 'rgba(255,255,255,0.95)');
      glass.addColorStop(1, 'rgba(178,206,235,0.6)');
      ctx.fillStyle = glass;
      circle(cx, cy, R);
      ctx.fill();

      // 구슬
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const b of balls) drawBall(b, true);

      // 유리 반짝임과 테두리
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = R * 0.045;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.84, Math.PI * 1.08, Math.PI * 1.38);
      ctx.stroke();
      ctx.lineWidth = R * 0.02;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.84, Math.PI * 1.45, Math.PI * 1.52);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(70,105,140,0.55)';
      ctx.lineWidth = R * 0.025;
      circle(cx, cy, R);
      ctx.stroke();

      // 투명한 관
      tubePath();
      ctx.strokeStyle = 'rgba(70,105,140,0.55)';
      ctx.lineWidth = R * 0.28;
      ctx.stroke();
      tubePath();
      ctx.strokeStyle = 'rgba(228,240,251,0.92)';
      ctx.lineWidth = R * 0.235;
      ctx.stroke();
      // 관 연결부
      ctx.fillStyle = '#9fb2c6';
      ctx.fillRect(cx - R * 0.19, cy - R * 1.04, R * 0.38, R * 0.1);

      // 받침 컵 (뒤쪽)
      ctx.strokeStyle = '#8da1b7';
      ctx.lineWidth = R * 0.04;
      ctx.beginPath();
      ctx.arc(cupX, cupY - R * 0.02, R * 0.14, Math.PI * 0.05, Math.PI * 0.95);
      ctx.stroke();

      // 뽑힌 구슬
      if (traveler) {
        const tr = traveler;
        if (tr.glow > 0) {
          ctx.shadowColor = 'rgba(255, 210, 70, 0.95)';
          ctx.shadowBlur = R * 0.3 * tr.glow;
        }
        drawBall(tr, false);
        ctx.shadowBlur = 0;
      }

      // 관 반짝임과 출구
      tubePath(-R * 0.055, -R * 0.03);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = R * 0.025;
      ctx.stroke();
      const [ox, oy] = [cx + PATH.pts[PATH.tubeEnd][0] * R, cy + PATH.pts[PATH.tubeEnd][1] * R];
      ctx.fillStyle = '#9fb2c6';
      ctx.fillRect(ox - R * 0.15, oy - R * 0.02, R * 0.3, R * 0.07);
    }

    function frame(t) {
      if (!last) last = t;
      const dt = Math.min((t - last) / 1000, 1 / 30);
      last = t;
      const k = Math.min(1, (t - mix.t0) / mix.dur);
      mix.level = mix.from + (mix.to - mix.from) * k;
      const sub = 3;
      for (let i = 0; i < sub; i++) step(dt / sub);
      updateTraveler(performance.now());
      render();
      requestAnimationFrame(frame);
    }

    function toPage(x, y) {
      const rect = cv.getBoundingClientRect();
      return { x: rect.left + x, y: rect.top + y };
    }

    return {
      resize,
      fill,
      mixTo,
      launch,
      hideTraveler() { traveler = null; },
      start() { requestAnimationFrame(frame); },
    };
  })();

  /* ---------------- 꽃가루 ---------------- */
  const confetti = (() => {
    const cv = els.confetti;
    const ctx = cv.getContext('2d');
    let parts = [];
    let running = false;
    let last = 0;

    function size() {
      const d = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(window.innerWidth * d);
      cv.height = Math.round(window.innerHeight * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }

    function tick(t) {
      if (!last) last = t;
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      const w = window.innerWidth, h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      parts = parts.filter((p) => p.y < h + 30 && p.life > 0);
      for (const p of parts) {
        p.sway += dt * 3;
        p.vy += p.g * dt;
        p.x += (p.vx + Math.sin(p.sway) * 50) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.life -= dt;
        ctx.save();
        ctx.globalAlpha = Math.min(1, p.life);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.sway)));
        ctx.restore();
      }
      if (parts.length) requestAnimationFrame(tick);
      else { running = false; ctx.clearRect(0, 0, w, h); }
    }

    function run() {
      if (!running) { running = true; last = 0; requestAnimationFrame(tick); }
    }

    const piece = (o) => ({
      w: 8 + Math.random() * 10,
      h: 6 + Math.random() * 8,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 10,
      sway: Math.random() * Math.PI * 2,
      g: 0,
      life: 99,
      ...o,
    });

    return {
      // 위에서 쏟아지는 꽃가루
      burst() {
        if (reduceMotion) return;
        size();
        const w = window.innerWidth, h = window.innerHeight;
        for (let i = 0; i < 200; i++) {
          parts.push(piece({
            x: Math.random() * w,
            y: -20 - Math.random() * h * 0.6,
            vx: (Math.random() - 0.5) * 120,
            vy: 160 + Math.random() * 260,
            c: PALETTE[i % PALETTE.length][0],
          }));
        }
        run();
      },
      // 한 점에서 터지는 반짝이
      pop(x, y, n) {
        if (reduceMotion) return;
        size();
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 250 + Math.random() * 450;
          parts.push(piece({
            x, y,
            vx: Math.cos(a) * sp,
            vy: Math.sin(a) * sp - 150,
            g: 700,
            life: 1.6 + Math.random() * 0.6,
            c: i % 3 === 0 ? '#ffffff' : PALETTE[i % PALETTE.length][0],
          }));
        }
        run();
      },
      stop() { parts = []; },
    };
  })();

  /* ---------------- 화면 그리기 ---------------- */
  function makeBallEl(num) {
    const [c, cd] = colorFor(num);
    const ball = document.createElement('div');
    ball.className = 'ball' + (num >= 100 ? ' three' : '');
    ball.style.setProperty('--c', c);
    ball.style.setProperty('--cd', cd);
    const span = document.createElement('span');
    span.textContent = String(num);
    ball.appendChild(span);
    return ball;
  }

  function renderSlots() {
    const c = settings.count;
    let size;
    if (c <= 7) size = 'min(13vh, 10vw)';
    else if (c <= 10) size = 'min(11vh, 7.5vw)';
    else if (c <= 15) size = 'min(9vh, 5.6vw)';
    else size = 'min(7vh, 4.4vw)';
    els.slots.style.setProperty('--slot', size);
    els.slots.innerHTML = '';
    for (let i = 0; i < c; i++) {
      const li = document.createElement('li');
      li.className = 'slot';
      li.setAttribute('aria-label', `${i + 1}번째 칸, 비어 있음`);
      els.slots.appendChild(li);
    }
  }

  function syncInputs() {
    els.minInput.value = settings.min;
    els.maxInput.value = settings.max;
    els.countInput.value = settings.count;
  }

  function updateUI() {
    const lockSettings = state.phase !== 'idle' || state.busy;
    [els.minInput, els.maxInput, els.countInput, els.countMinus, els.countPlus, ...els.modeBtns]
      .forEach((el) => { el.disabled = lockSettings; });

    for (const btn of els.modeBtns) {
      btn.setAttribute('aria-checked', String(btn.dataset.mode === settings.mode));
    }
    for (const btn of els.speedBtns) {
      btn.setAttribute('aria-checked', String(btn.dataset.speed === settings.speed));
      btn.disabled = state.busy;
    }

    let label = '추첨 시작';
    if (state.busy) label = '추첨 중...';
    else if (state.phase === 'done') label = '추첨 끝';
    else if (state.phase === 'drawing') label = '다음 구슬';
    els.drawBtn.textContent = label;
    els.drawBtn.disabled = state.busy || state.phase === 'done'
      || (state.phase === 'idle' && Boolean(validate(readInputs())));
    els.resetBtn.disabled = state.busy;

    els.soundBtn.textContent = settings.sound ? '소리 켜짐' : '소리 꺼짐';
    els.soundBtn.setAttribute('aria-pressed', String(settings.sound));
  }

  function prepareRound() {
    state.pool = [];
    for (let n = settings.min; n <= settings.max; n++) state.pool.push(n);
    state.picked = [];
    renderSlots();
    machine.fill(state.pool);
  }

  function onSettingsChange() {
    if (state.phase !== 'idle' || state.busy) return;
    const v = readInputs();
    const err = validate(v);
    els.message.textContent = err;
    if (!err) {
      const needsRebuild = v.min !== settings.min || v.max !== settings.max || v.count !== settings.count;
      Object.assign(settings, v);
      saveSettings();
      if (needsRebuild) prepareRound();
    }
    updateUI();
  }

  /* ---------------- 추첨 ---------------- */
  // 컵에 떨어진 구슬을 화면 가운데로 꺼내, 어두운 화면에서 뒤집으며 숫자를 공개한 뒤 결과 칸으로 보냄
  async function revealAndPlace(num, index, from) {
    const slot = els.slots.children[index];
    const rv = els.reveal;
    const size = Math.round(Math.min(window.innerHeight * 0.42, window.innerWidth * 0.3, 380));
    rv.innerHTML = '';
    rv.style.width = `${size}px`;
    rv.style.height = `${size}px`;
    rv.style.setProperty('--slot', `${size}px`);

    const rays = document.createElement('div');
    rays.className = 'rays';
    rv.appendChild(rays);
    const ball = makeBallEl(num);
    ball.classList.remove('three');
    const label = ball.querySelector('span');
    label.textContent = '?';
    rv.appendChild(ball);

    const px = window.innerWidth / 2;
    const py = window.innerHeight * 0.44;
    rv.style.left = `${px - size / 2}px`;
    rv.style.top = `${py - size / 2}px`;

    els.dimCaption.textContent = '어떤 숫자가 나왔을까요?';
    els.dim.classList.add('on');
    rv.classList.add('show');
    machine.hideTraveler();

    const flyIn = T(800), wobble = T(1100), flipOut = T(160);
    sound.drumroll((flyIn + wobble + flipOut) / 1000);

    // 1) 컵에서 화면 가운데로 크게 떠오르기
    await rv.animate([
      { transform: `translate(${from.x - px}px, ${from.y - py}px) scale(${(from.r * 2) / size})` },
      { transform: 'translate(0, 0) scale(1)' },
    ], { duration: flyIn, easing: 'cubic-bezier(.3,1.25,.5,1)', fill: 'forwards' }).finished;

    // 2) 흔들흔들 뜸 들이기
    await ball.animate([
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(-10deg) scale(1.03)' },
      { transform: 'rotate(10deg) scale(1.05)' },
      { transform: 'rotate(-8deg) scale(1.07)' },
      { transform: 'rotate(8deg) scale(1.09)' },
      { transform: 'rotate(0deg) scale(1.1)' },
    ], { duration: wobble, easing: 'ease-in-out', fill: 'forwards' }).finished;

    // 3) 휙 뒤집으며 숫자 공개
    await ball.animate([
      { transform: 'perspective(900px) rotateY(0deg) scale(1.1)' },
      { transform: 'perspective(900px) rotateY(90deg) scale(1.1)' },
    ], { duration: flipOut, easing: 'ease-in', fill: 'forwards' }).finished;
    label.textContent = String(num);
    if (num >= 100) ball.classList.add('three');
    rays.classList.add('on');
    sound.reveal();
    confetti.pop(px, py, 80);
    const text = `${index + 1}번째 숫자는 ${num}`;
    els.dimCaption.textContent = text;
    els.status.textContent = text;
    await ball.animate([
      { transform: 'perspective(900px) rotateY(-90deg) scale(1.1)' },
      { transform: 'perspective(900px) rotateY(0deg) scale(1.25)', offset: 0.6 },
      { transform: 'perspective(900px) rotateY(0deg) scale(1)' },
    ], { duration: T(450), easing: 'ease-out', fill: 'forwards' }).finished;

    await wait(T(1500));

    // 4) 결과 칸으로 날아가기
    els.dim.classList.remove('on');
    rays.classList.remove('on');
    const sr = slot.getBoundingClientRect();
    const dx = sr.left + sr.width / 2 - px;
    const dy = sr.top + sr.height / 2 - py;
    await rv.animate([
      { transform: 'translate(0, 0) scale(1)' },
      { transform: `translate(${dx}px, ${dy}px) scale(${sr.width / size})` },
    ], { duration: T(650), easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' }).finished;

    slot.classList.add('filled');
    slot.innerHTML = '';
    slot.appendChild(makeBallEl(num));
    slot.setAttribute('aria-label', `${index + 1}번째 숫자 ${num}`);

    rv.classList.remove('show');
    rv.getAnimations().forEach((a) => a.cancel());
    rv.innerHTML = '';
  }

  async function drawOne(isFirst) {
    // 1) 점점 세게 섞기
    const mixMs = T(isFirst ? 2000 : 1400);
    machine.mixTo(1.75, mixMs);
    sound.rattle(mixMs / 1000);
    sound.whoosh(mixMs / 1000);
    els.status.textContent = '구슬을 섞고 있어요...';
    await wait(mixMs);

    // 2) 공정하게 하나 고르기
    const num = state.pool.splice(randInt(state.pool.length), 1)[0];

    // 3) 바람이 멈추고, 구슬 하나가 빨려 올라가 관을 타고 굴러 떨어짐
    machine.mixTo(0, T(700));
    els.status.textContent = '구슬 하나가 나오고 있어요!';
    const travelMs = T(1700);
    const from = await machine.launch(num, {
      capture: T(600),
      travel: travelMs,
      land: T(550),
      onCapture: () => sound.suck(),
      onTravel: () => sound.roll(travelMs / 1000),
      onLand: () => sound.clack(),
    });
    await wait(T(250));

    // 4) 두구두구 공개
    await revealAndPlace(num, state.picked.length, from);
    state.picked.push(num);
    sound.ding();
  }

  async function onDraw() {
    if (state.busy || state.phase === 'done') return;
    sound.unlock();

    if (state.phase === 'idle') {
      const v = readInputs();
      const err = validate(v);
      if (err) { els.message.textContent = err; return; }
      Object.assign(settings, v);
      saveSettings();
      prepareRound();
      state.phase = 'drawing';
    }

    state.busy = true;
    updateUI();
    try {
      if (settings.mode === 'auto') {
        while (state.picked.length < settings.count) {
          await drawOne(state.picked.length === 0);
          if (state.picked.length < settings.count) await wait(T(350));
        }
      } else {
        await drawOne(state.picked.length === 0);
      }
    } finally {
      state.busy = false;
    }

    if (state.picked.length >= settings.count) {
      state.phase = 'done';
      els.status.textContent = `추첨 끝! ${settings.count}개를 모두 뽑았어요`;
      sound.fanfare();
      confetti.burst();
    } else {
      els.status.textContent = `${state.picked.length}개 뽑았어요. 다음 구슬을 눌러 주세요`;
    }
    updateUI();
  }

  function onReset() {
    if (state.busy) return;
    state.phase = 'idle';
    confetti.stop();
    els.status.textContent = IDLE_STATUS;
    const err = validate(readInputs());
    els.message.textContent = err;
    if (!err) {
      Object.assign(settings, readInputs());
      saveSettings();
    }
    prepareRound();
    updateUI();
  }

  function changeCount(delta) {
    const v = readInputs();
    const size = Number.isNaN(v.min) || Number.isNaN(v.max) ? LIMITS.maxCount : v.max - v.min + 1;
    const cap = Math.max(1, Math.min(LIMITS.maxCount, size));
    const cur = Number.isNaN(v.count) ? settings.count : v.count;
    els.countInput.value = Math.min(cap, Math.max(1, cur + delta));
    onSettingsChange();
  }

  /* ---------------- 이벤트 연결 ---------------- */
  [els.minInput, els.maxInput, els.countInput].forEach((el) => el.addEventListener('input', onSettingsChange));
  els.countMinus.addEventListener('click', () => changeCount(-1));
  els.countPlus.addEventListener('click', () => changeCount(1));

  els.modeBtns.forEach((btn) => btn.addEventListener('click', () => {
    if (state.phase !== 'idle') return;
    settings.mode = btn.dataset.mode;
    saveSettings();
    updateUI();
  }));

  els.speedBtns.forEach((btn) => btn.addEventListener('click', () => {
    if (state.busy) return;
    settings.speed = btn.dataset.speed;
    saveSettings();
    updateUI();
  }));

  els.drawBtn.addEventListener('click', onDraw);
  els.resetBtn.addEventListener('click', onReset);

  els.soundBtn.addEventListener('click', () => {
    settings.sound = !settings.sound;
    saveSettings();
    if (settings.sound) sound.unlock();
    updateUI();
  });

  els.fullBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      const req = document.documentElement.requestFullscreen;
      if (req) req.call(document.documentElement).catch(() => {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  });
  document.addEventListener('fullscreenchange', () => {
    els.fullBtn.textContent = document.fullscreenElement ? '전체화면 끄기' : '전체화면';
  });

  // 스페이스바, 엔터, 오른쪽 화살표, PageDown(발표용 리모컨)으로도 추첨
  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT') return;
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
    if ([' ', 'Enter', 'ArrowRight', 'PageDown'].includes(e.key)) {
      e.preventDefault();
      if (!els.drawBtn.disabled) onDraw();
    }
  });

  /* ---------------- 시작 ---------------- */
  syncInputs();
  machine.resize();
  new ResizeObserver(() => machine.resize()).observe(els.machine);
  prepareRound();
  els.status.textContent = IDLE_STATUS;
  updateUI();
  machine.start();
})();
