let smoothedX = 0, smoothedY = 0;
const GAZE_SENSITIVITY_X = 2.2;
const GAZE_SENSITIVITY_Y = 13;
const CONFIDENCE_THRESHOLD = 0.94;
let baselineVx = null, baselineVy = null;
let baselineFrameCount = 0;
const BASELINE_MAX_FRAMES = 30;
const BASELINE_UPDATE_THRESHOLD = 0.005;
const SMOOTHING = 0.2;

let video = null, overlayCanvas = null, cursor = null, detector = null;
let heatCanvas, heatCtx;

const collectedData = [];
let currentCalibrationTarget = null;
let isCollecting = false;

class KalmanFilter {
  constructor(processNoise = 0.0008, measurementNoise = 0.008, errorCov = 1) {
    this.processNoise = processNoise;
    this.measurementNoise = measurementNoise;
    this.errorCov = errorCov;
    this.estimate = 0;
  }
  update(measurement) {
    const pred = this.estimate;
    this.errorCov += this.processNoise;
    const kalmanGain = this.errorCov / (this.errorCov + this.measurementNoise);
    this.estimate = pred + kalmanGain * (measurement - pred);
    this.errorCov *= (1 - kalmanGain);
    return this.estimate;
  }
}
const kalmanX = new KalmanFilter();
const kalmanY = new KalmanFilter();

function createHeatMapLayer() {
  heatCanvas = document.createElement('canvas');
  heatCanvas.width = window.innerWidth;
  heatCanvas.height = window.innerHeight;
  Object.assign(heatCanvas.style, {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: 1500
  });
  document.body.appendChild(heatCanvas);
  heatCtx = heatCanvas.getContext('2d');
}

async function initCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Webcam not supported.');
    return null;
  }

  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    top: '10px',
    right: '10px',
    width: '240px',
    height: '180px',
    zIndex: '10000',
    border: '2px solid blue',
    overflow: 'hidden'
  });
  document.body.appendChild(container);

  video = document.createElement('video');
  Object.assign(video, { autoplay: true, playsInline: true });
  Object.assign(video.style, {
    width: '100%',
    height: '100%',
    transform: 'scaleX(-1)',
    position: 'absolute',
    top: '0',
    left: '0'
  });
  container.appendChild(video);

  overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = 240;
  overlayCanvas.height = 180;
  Object.assign(overlayCanvas.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    pointerEvents: 'none',
    width: '100%',
    height: '100%',
    zIndex: '10001'
  });
  container.appendChild(overlayCanvas);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
    });
    video.srcObject = stream;
    await video.play();
    console.log('Camera initialized');
    return video;
  } catch (error) {
    console.error('Camera error:', error.message);
    alert('Failed to access webcam.');
    return null;
  }
}

async function loadModel() {
  if (!window.faceLandmarksDetection) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_landmarks_detection';
    document.head.appendChild(script);
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = reject;
    });
  }

  const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
  const detectorConfig = {
    runtime: 'mediapipe',
    solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
    maxFaces: 1,
    refineLandmarks: true,
    modelType: 'full'
  };

  detector = await faceLandmarksDetection.createDetector(model, detectorConfig);
  console.log('Model loaded');
  return detector;
}

function calculateDistance(p1, p2) {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

function createCursor() {
  cursor = document.createElement('div');
  Object.assign(cursor.style, {
    position: 'fixed',
    width: '12px',
    height: '12px',
    backgroundColor: 'red',
    borderRadius: '50%',
    pointerEvents: 'none',
    zIndex: '2000'
  });
  document.body.appendChild(cursor);
}

function downloadCSV(data) {
  if (data.length === 0) {
    alert('No data to download');
    return;
  }
  const csvRows = [Object.keys(data[0]).join(',')];
  for (const row of data) csvRows.push(Object.values(row).join(','));
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gaze_data.csv';
  a.click();
  URL.revokeObjectURL(url);
}

async function continueDetection() {
  if (!video || !detector) return;
  const faces = await detector.estimateFaces(video);
  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (faces.length > 0) {
    const keypoints = faces[0].keypoints;
    const leftEyeIris = keypoints[472];
    const rightEyeIris = keypoints[477];
    const leftEyeInnerCorner = keypoints[133];
    const rightEyeInnerCorner = keypoints[362];
    const noseBridge = keypoints[168];
    const noseTip = keypoints[2];

    const eyeCenter = {
      x: (leftEyeInnerCorner.x + rightEyeInnerCorner.x) / 2,
      y: (leftEyeInnerCorner.y + rightEyeInnerCorner.y) / 2
    };
    const irisCenter = {
      x: (leftEyeIris.x + rightEyeIris.x) / 2,
      y: (leftEyeIris.y + rightEyeIris.y) / 2
    };

    const gazeVector = { x: irisCenter.x - eyeCenter.x, y: irisCenter.y - eyeCenter.y };
    const L = calculateDistance(leftEyeInnerCorner, rightEyeInnerCorner);
    const H = Math.max(0.001, calculateDistance(noseBridge, noseTip));
    const Vx = gazeVector.x / L;
    const Vy = gazeVector.y / H;

    if (baselineFrameCount < BASELINE_MAX_FRAMES) {
      if (baselineVx === null) baselineVx = Vx;
      if (baselineVy === null) baselineVy = Vy;
      if (Math.abs(Vx - baselineVx) < BASELINE_UPDATE_THRESHOLD) {
        baselineVx = 0.9 * baselineVx + 0.1 * Vx;
      }
      if (Math.abs(Vy - baselineVy) < BASELINE_UPDATE_THRESHOLD) {
        baselineVy = 0.9 * baselineVy + 0.1 * Vy;
      }
      baselineFrameCount++;
    }

    const centeredVx = Vx - baselineVx;
    const centeredVy = Vy - baselineVy;
    smoothedX = smoothedX * (1 - SMOOTHING) + centeredVx * SMOOTHING;
    smoothedY = smoothedY * (1 - SMOOTHING) + centeredVy * SMOOTHING;

    const dx = smoothedX * window.innerWidth * GAZE_SENSITIVITY_X;
    const dy = smoothedY * window.innerHeight * GAZE_SENSITIVITY_Y;

    const clampedX = Math.min(Math.max(window.innerWidth / 2 + dx, 0), window.innerWidth);
    const clampedY = Math.min(Math.max(window.innerHeight / 2 + dy, 0), window.innerHeight);

    cursor.style.left = `${clampedX}px`;
    cursor.style.top = `${clampedY}px`;

    heatCtx.beginPath();
    heatCtx.arc(clampedX, clampedY, 3, 0, 2 * Math.PI);
    heatCtx.fillStyle = 'rgba(255, 0, 0, 0.1)';
    heatCtx.fill();
  }

  requestAnimationFrame(continueDetection);
}

async function main() {
  createHeatMapLayer();
  video = await initCamera();
  if (!video) return;
  detector = await loadModel();
  if (!detector) return;
  createCursor();
  continueDetection();
}

main();

