(() => {
  // ---------- Tunables & runtime toggles ----------
  const VIDEO_W = 360, VIDEO_H = 270;
  const VIDEO_RIGHT = 16, VIDEO_TOP = 16;

  const MIN_CONF = 0.85;            // drop low-confidence frames
  const SMOOTHING = 0.35;           // 0..1 (higher = smoother)
  const GAIN_X = 4.5;               // horizontal reach (increase to reach edges)
  const GAIN_Y = 6.5;               // vertical reach (increase to reach edges)

  const BASELINE_MAX_FRAMES = 30;   // warm-up frames while looking straight
  const BASELINE_DELTA_MAX = 0.02;  // ignore large deviations during baseline

  // If preview <video> is mirrored (scaleX(-1)), start with X flipped. Press 'M' to toggle.
  let X_SIGN = -1;                  // -1 mirrored, +1 normal
  const Y_SIGN = -1;                // screen y grows downward

  const MAX_STEP = 0.12;            // per-frame max move in normalized space
  const DOT_SIZE = 12;              // px

  // Dwell-to-click
  const DWELL_MS = 600;             // fixation time before click
  const MAX_TARGET_DIST = 140;      // px, beyond this we won't interact
  const HILITE_MAIN = '0 0 10px rgba(255,0,0,.9)';
  const HILITE_ALT  = '0 0 6px rgba(255,165,0,.8)';

  // ---------- State ----------
  let video, canvas, ctx, dot, detector;
  let sX = 0, sY = 0;               // smoothed coords
  let baselineVx = null, baselineVy = null, baselineFrames = 0;

  let lastTop = null;
  let lastTopSince = 0;
  let lastHilites = [];

  // ---------- Utilities ----------
  function log(...a) { console.log('[app]', ...a); }
  function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

  function irisIsReasonable(pts5) {
    if (!pts5 || pts5.length !== 5) return false;
    let minD = Infinity, maxD = 0;
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
      const dx = pts5[i].x - pts5[j].x;
      const dy = pts5[i].y - pts5[j].y;
      const d = Math.hypot(dx, dy);
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;
    }
    return Number.isFinite(minD) && minD > 0 && (maxD / minD) < 2.5;
  }

  function extractFeatures(kp) {
    // MediaPipe indices:
    // left iris  : 468..472 (use 472 as center)
    // right iris : 473..477 (use 477 as center)
    const leftIrisC  = kp[472];
    const rightIrisC = kp[477];
    const leftCorner  = kp[133];
    const rightCorner = kp[362];
    const noseBridge  = kp[168];
    const noseTip     = kp[2];

    if (!leftIrisC || !rightIrisC || !leftCorner || !rightCorner || !noseBridge || !noseTip) {
      return null;
    }
    const eyeCenter = {
      x: (leftCorner.x + rightCorner.x) / 2,
      y: (leftCorner.y + rightCorner.y) / 2
    };
    const irisCenter = {
      x: (leftIrisC.x + rightIrisC.x) / 2,
      y: (leftIrisC.y + rightIrisC.y) / 2
    };
    const Vg = { x: irisCenter.x - eyeCenter.x, y: irisCenter.y - eyeCenter.y };

    const L = Math.max(1e-6, Math.hypot(rightCorner.x - leftCorner.x, rightCorner.y - leftCorner.y));
    const H = Math.max(1e-6, Math.hypot(noseTip.x - noseBridge.x, noseTip.y - noseBridge.y));

    return { Vx: Vg.x / L, Vy: Vg.y / H };
  }

  function updateBaseline(Vx, Vy) {
    if (baselineFrames >= BASELINE_MAX_FRAMES) return;
    if (baselineVx === null) baselineVx = Vx;
    if (baselineVy === null) baselineVy = Vy;

    if (Math.abs(Vx - baselineVx) < BASELINE_DELTA_MAX) baselineVx = 0.9 * baselineVx + 0.1 * Vx;
    if (Math.abs(Vy - baselineVy) < BASELINE_DELTA_MAX) baselineVy = 0.9 * baselineVy + 0.1 * Vy;
    baselineFrames += 1;
  }

  function centerAmplify(Vx, Vy) {
    let cx = (Vx - (baselineVx ?? Vx)) * X_SIGN * GAIN_X;
    let cy = (Vy - (baselineVy ?? Vy)) * Y_SIGN * GAIN_Y;
    return { x: cx, y: cy };
  }

  function limitStep(prev, next, maxStep) {
    const d = next - prev;
    if (Math.abs(d) <= maxStep) return next;
    return prev + Math.sign(d) * maxStep;
  }

  function smoothWithLimiter(x, y) {
    const limX = limitStep(sX, x, MAX_STEP);
    const limY = limitStep(sY, y, MAX_STEP);
    sX = sX * (1 - SMOOTHING) + limX * SMOOTHING;
    sY = sY * (1 - SMOOTHING) + limY * SMOOTHING;
    return { x: sX, y: sY };
  }

  // ---------- Camera & UI ----------
  async function setupCamera() {
    const v = document.createElement('video');
    v.autoplay = true;
    v.playsInline = true;
    v.muted = true;

    // place on the right, mirrored
    Object.assign(v.style, {
      position: 'fixed',
      right: `${VIDEO_RIGHT}px`,
      top: `${VIDEO_TOP}px`,
      width: `${VIDEO_W}px`,
      height: `${VIDEO_H}px`,
      transform: 'scaleX(-1)',
      zIndex: 1000,
      borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,.25)',
      background: '#000'
    });

    document.body.appendChild(v);

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: 'user' }
    });
    v.srcObject = stream;
    await new Promise(res => v.onloadedmetadata = res);
    v.play();
    return v;
  }

  function setupCanvasForVideo(v) {
    const c = document.createElement('canvas');
    c.width  = v.videoWidth || 1280;
    c.height = v.videoHeight || 720;
    Object.assign(c.style, {
      position: 'fixed',
      right: `${VIDEO_RIGHT}px`,
      top: `${VIDEO_TOP}px`,
      width: `${VIDEO_W}px`,
      height: `${VIDEO_H}px`,
      transform: 'scaleX(-1)',
      zIndex: 1001,
      pointerEvents: 'none'
    });
    document.body.appendChild(c);
    return c.getContext('2d', { willReadFrequently: true }).canvas.getContext('2d') || c.getContext('2d');
  }

  function createDot() {
    const d = document.createElement('div');
    const s = DOT_SIZE;
    Object.assign(d.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      width: `${s}px`,
      height: `${s}px`,
      marginLeft: `${-s/2}px`,
      marginTop: `${-s/2}px`,
      background: '#ff1744',
      borderRadius: '50%',
      zIndex: 1500,
      pointerEvents: 'none',
      boxShadow: '0 0 10px rgba(255,0,0,.7)'
    });
    document.body.appendChild(d);
    return d;
  }

  // ---------- Detector ----------
  async function loadFaceMeshDetector() {
    if (!window.faceLandmarksDetection) {
      throw new Error('face-landmarks-detection not loaded.');
    }
    const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
    const detectorConfig = {
      runtime: 'mediapipe',
      solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
      refineLandmarks: true,
      maxFaces: 1,
      modelType: 'full'
    };
    return faceLandmarksDetection.createDetector(model, detectorConfig);
  }

  // ---------- Actionables + Dwell ----------
  function getActionables() {
    return Array.from(document.querySelectorAll(
      'button, input, textarea, select, a, [role="button"], [role="link"], [role="checkbox"], [role="textbox"]'
    )).filter(el => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2) return false;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      return true;
    });
  }

  function scoreCandidates(cx, cy, els) {
    const cand = [];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const dist = Math.hypot(ex - cx, ey - cy);
      if (dist > 800) continue; // far away: ignore
      const sizeFactor = Math.min((r.width * r.height) / 15000, 1.2);
      const distScore = Math.max(0, 1 - (dist / 400));
      let typeScore = 1.0;
      const tag = el.tagName.toLowerCase();
      if (tag === 'button' || el.getAttribute('role') === 'button') typeScore = 1.2;
      else if (tag === 'input' || tag === 'textarea' || el.getAttribute('role') === 'textbox') typeScore = 1.3;
      else if (tag === 'a' || el.getAttribute('role') === 'link') typeScore = 1.0;

      const score = distScore * typeScore * sizeFactor;
      if (score > 0.05) cand.push({ el, score, dist, centerX: ex, centerY: ey });
    }
    cand.sort((a, b) => b.score - a.score);
    return cand.slice(0, 3);
  }

  function clearHilites() {
    for (const h of lastHilites) {
      h.el.style.boxShadow = h.prevShadow;
      h.el.style.outline = h.prevOutline;
    }
    lastHilites = [];
  }

  function hiliteTop(cands) {
    clearHilites();
    cands.forEach((c, idx) => {
      const prevShadow = c.el.style.boxShadow;
      const prevOutline = c.el.style.outline;
      c.el.style.boxShadow = idx === 0 ? HILITE_MAIN : HILITE_ALT;
      c.el.style.outline = idx === 0 ? '2px solid rgba(255,0,0,.6)' : '1px solid rgba(255,165,0,.6)';
      lastHilites.push({ el: c.el, prevShadow, prevOutline });
    });
  }

  function maybeDwellClick(topCand, now) {
    if (!topCand) {
      lastTop = null;
      lastTopSince = 0;
      return;
    }
    const same = (lastTop && lastTop.el === topCand.el);
    if (!same) {
      lastTop = topCand;
      lastTopSince = now;
      return;
    }
    const dt = now - lastTopSince;
    if (dt >= DWELL_MS && topCand.dist < MAX_TARGET_DIST) {
      // Trigger
      const el = topCand.el;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || el.getAttribute('role') === 'textbox') {
        el.focus();
      } else {
        el.click();
      }
      lastTopSince = now + 1e9; // prevent repeated firing
    }
  }

  // ---------- Main loop ----------
  async function loop() {
    try {
      const faces = await detector.estimateFaces(video);
      // draw preview frame (landmarks overlay removed for clarity)
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

      if (faces && faces.length) {
        const f = faces[0];
        if (typeof f.faceInViewConfidence === 'number' && f.faceInViewConfidence < MIN_CONF) {
          requestAnimationFrame(loop);
          return;
        }

        const kp = f.keypoints;
        const leftIris5  = [kp[468], kp[469], kp[470], kp[471], kp[472]];
        const rightIris5 = [kp[473], kp[474], kp[475], kp[476], kp[477]];
        if (!irisIsReasonable(leftIris5) || !irisIsReasonable(rightIris5)) {
          requestAnimationFrame(loop);
          return;
        }

        const feats = extractFeatures(kp);
        if (feats) {
          const { Vx, Vy } = feats;
          updateBaseline(Vx, Vy);

          const vec = centerAmplify(Vx, Vy);
          const sm  = smoothWithLimiter(vec.x, vec.y);

          // map to screen
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          const dx = sm.x * window.innerWidth;
          const dy = sm.y * window.innerHeight;

          let x = cx + dx - DOT_SIZE/2;
          let y = cy + dy - DOT_SIZE/2;
          x = clamp(x, -DOT_SIZE/2, window.innerWidth  - DOT_SIZE/2);
          y = clamp(y, -DOT_SIZE/2, window.innerHeight - DOT_SIZE/2);

          dot.style.left = `${x}px`;
          dot.style.top  = `${y}px`;

          // Interactions
          const dotCenterX = x + DOT_SIZE/2;
          const dotCenterY = y + DOT_SIZE/2;
          const cands = scoreCandidates(dotCenterX, dotCenterY, getActionables());
          hiliteTop(cands);
          maybeDwellClick(cands[0], performance.now());
        }
      }
    } catch (e) {
      console.warn('[status] loop warn', e);
    }
    requestAnimationFrame(loop);
  }

  // ---------- Boot ----------
  async function boot() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia not supported.');
      video = await setupCamera();
      // Canvas needs to be created after video has metadata to size correctly
      const c = document.createElement('canvas');
      c.width  = video.videoWidth || 1280;
      c.height = video.videoHeight || 720;
      Object.assign(c.style, {
        position: 'fixed',
        right: `${VIDEO_RIGHT}px`,
        top: `${VIDEO_TOP}px`,
        width: `${VIDEO_W}px`,
        height: `${VIDEO_H}px`,
        transform: 'scaleX(-1)',
        zIndex: 1001,
        pointerEvents: 'none'
      });
      document.body.appendChild(c);
      ctx = c.getContext('2d');

      dot = createDot();
      detector = await loadFaceMeshDetector();

      // Keyboard toggles
      window.addEventListener('keydown', (e) => {
        const k = e.key.toLowerCase();
        if (k === 'b') {
          baselineVx = baselineVy = null; baselineFrames = 0;
          console.log('[status] baseline reset');
        } else if (k === 'm') {
          X_SIGN *= -1;
          console.log('[status] flipped X_SIGN; now', X_SIGN === -1 ? 'mirrored' : 'normal');
        }
      });

      requestAnimationFrame(loop);
      log('ready');
    } catch (e) {
      console.error('[status] boot error:', e);
    }
  }

  // Run
  document.addEventListener('DOMContentLoaded', boot);
})();
