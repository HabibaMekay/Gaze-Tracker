let smoothedX = 0, smoothedY = 0;
const SMOOTHING = 0.85;
const GAZE_SENSITIVITY_X = 2.2;
const GAZE_SENSITIVITY_Y = 13;
const CONFIDENCE_THRESHOLD = 0.94;
let baselineGaze = null;
let video = null, overlayCanvas = null, cursor = null, detector = null;
let initialFrames = [];
const INITIAL_FRAME_COUNT = 30;

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

async function initCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Webcam not supported.');
    return null;
  }

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '10px';
  container.style.right = '10px';
  container.style.width = '240px';
  container.style.height = '180px';
  container.style.zIndex = '10000';
  container.style.border = '2px solid blue';
  container.style.overflow = 'hidden';
  document.body.appendChild(container);

  video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.transform = 'scaleX(-1)';
  video.style.position = 'absolute';
  video.style.top = '0';
  video.style.left = '0';
  video.style.zIndex = '9999';
  container.appendChild(video);

  overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = 240;
  overlayCanvas.height = 180;
  overlayCanvas.style.position = 'absolute';
  overlayCanvas.style.top = '0';
  overlayCanvas.style.left = '0';
  overlayCanvas.style.pointerEvents = 'none';
  overlayCanvas.style.width = '100%';
  overlayCanvas.style.height = '100%';
  overlayCanvas.style.zIndex = '10001';
  container.appendChild(overlayCanvas);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }
    });
    video.srcObject = stream;
    await video.play();
    console.log('Camera initialized:', video.videoWidth, 'x', video.videoHeight);
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
    refineLandmarks: true
  };

  detector = await faceLandmarksDetection.createDetector(model, detectorConfig);
  console.log('Model loaded');
  return detector;
}

function estimateGaze(landmarks) {
  const leftEyeIris = landmarks[472];
  const rightEyeIris = landmarks[477];
  const leftEyeInnerCorner = landmarks[133];
  const rightEyeInnerCorner = landmarks[362];
  const leftEyeOuterCorner = landmarks[130];
  const rightEyeOuterCorner = landmarks[359];
  const leftEyelid = landmarks[159];
  const rightEyelid = landmarks[386];

  if (
    !leftEyeIris || !rightEyeIris || !leftEyeInnerCorner || !rightEyeInnerCorner ||
    !leftEyeOuterCorner || !rightEyeOuterCorner || !leftEyelid || !rightEyelid ||
    leftEyeIris.confidence < CONFIDENCE_THRESHOLD ||
    rightEyeIris.confidence < CONFIDENCE_THRESHOLD
  ) return null;

  const eyeCenter = {
    x: (0.3 * (leftEyeInnerCorner.x + rightEyeInnerCorner.x) + 0.2 * (leftEyeOuterCorner.x + rightEyeOuterCorner.x) + 0.25 * (leftEyelid.x + rightEyelid.x)) / 1.5,
    y: (0.3 * (leftEyeInnerCorner.y + rightEyeInnerCorner.y) + 0.2 * (leftEyeOuterCorner.y + rightEyeOuterCorner.y) + 0.25 * (leftEyelid.y + rightEyelid.y)) / 1.5
  };
  const irisCenter = {
    x: (leftEyeIris.x + rightEyeIris.x) / 2,
    y: (leftEyeIris.y + rightEyeIris.y) / 2
  };

  const L = calculateDistance(leftEyeInnerCorner, rightEyeInnerCorner);
  const H = calculateDistance(leftEyeInnerCorner, leftEyelid);
  const gazeVector = {
    x: (irisCenter.x - eyeCenter.x) / L,
    y: (irisCenter.y - eyeCenter.y) / H
  };

  const headYaw = Math.atan2(
    rightEyeInnerCorner.x - leftEyeInnerCorner.x,
    rightEyeInnerCorner.y - leftEyeInnerCorner.y
  ) * 180 / Math.PI;
  const headPitch = Math.atan2(
    (leftEyeInnerCorner.y + rightEyeInnerCorner.y) / 2 - landmarks[2].y,
    L
  ) * 180 / Math.PI;

  const adjustedGaze = {
    x: gazeVector.x - 0.0012 * headYaw,
    y: gazeVector.y - 0.0012 * headPitch
  };

  const faceDistance = L * 2;
  const distanceScale = Math.min(2.5, 2000 / faceDistance);
  return {
    x: -adjustedGaze.x * 0.75 * distanceScale,
    y: -adjustedGaze.y * 0.85 * distanceScale
  };
}

function checkLighting(video) {
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = video.videoWidth;
  tempCanvas.height = video.videoHeight;
  const ctx = tempCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
  const samples = [
    [video.videoWidth * 0.25, video.videoHeight * 0.25],
    [video.videoWidth * 0.75, video.videoHeight * 0.25],
    [video.videoWidth * 0.5, video.videoHeight * 0.5],
    [video.videoWidth * 0.25, video.videoHeight * 0.75],
    [video.videoWidth * 0.75, video.videoHeight * 0.75]
  ];
  let totalBrightness = 0;
  for (const [x, y] of samples) {
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    totalBrightness += (pixel[0] + pixel[1] + pixel[2]) / 3;
  }
  const brightness = totalBrightness / samples.length;
  return brightness >= 50 && brightness <= 200;
}

async function continueDetection() {
  if (!video || !detector || !overlayCanvas || !cursor) return;

  const faces = await detector.estimateFaces(video);
  const ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

  if (!checkLighting(video)) {
    requestAnimationFrame(continueDetection);
    return;
  }

  if (faces.length > 0) {
    const keypoints = faces[0].keypoints;

    ctx.save();
    ctx.scale(overlayCanvas.width, overlayCanvas.height); // map normalized to canvas
    ctx.translate(1, 0); // mirror
    ctx.scale(-1, 1);

    [keypoints[477], keypoints[472]].forEach(iris => {
      if (iris) {
        ctx.beginPath();
        ctx.arc(iris.x, iris.y, 0.02, 0, 2 * Math.PI); // 0.02 normalized radius
        ctx.fillStyle = 'red';
        ctx.fill();
      }
    });

    ctx.restore();

    const gaze = estimateGaze(keypoints);
    if (!gaze) {
      requestAnimationFrame(continueDetection);
      return;
    }

    if (initialFrames.length < INITIAL_FRAME_COUNT) {
      initialFrames.push(gaze);
      if (initialFrames.length === INITIAL_FRAME_COUNT) {
        baselineGaze = initialFrames.reduce((avg, p) => ({
          x: avg.x + p.x / INITIAL_FRAME_COUNT,
          y: avg.y + p.y / INITIAL_FRAME_COUNT
        }), { x: 0, y: 0 });
      }
      requestAnimationFrame(continueDetection);
      return;
    }

    const centeredGaze = {
      x: gaze.x - baselineGaze.x,
      y: gaze.y - baselineGaze.y
    };

    smoothedX = kalmanX.update(centeredGaze.x * (1 - SMOOTHING) + smoothedX * SMOOTHING);
    smoothedY = kalmanY.update(centeredGaze.y * (1 - SMOOTHING) + smoothedY * SMOOTHING);

    const dx = smoothedX * window.innerWidth * GAZE_SENSITIVITY_X;
    const dy = smoothedY * window.innerHeight * GAZE_SENSITIVITY_Y;

    const rawX = window.innerWidth / 2 + dx - cursor.offsetWidth / 2;
    const rawY = window.innerHeight / 2 + dy - cursor.offsetHeight / 2;

    const clampedX = Math.max(Math.min(rawX, window.innerWidth), 0);
    const clampedY = Math.max(Math.min(rawY, window.innerHeight), 0);

    cursor.style.left = `${clampedX}px`;
    cursor.style.top = `${clampedY}px`;
  }

  requestAnimationFrame(continueDetection);
}

function calculateDistance(p1, p2) {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

function createCursor() {
  cursor = document.createElement('div');
  cursor.style.position = 'fixed';
  cursor.style.width = '12px';
  cursor.style.height = '12px';
  cursor.style.backgroundColor = 'red';
  cursor.style.borderRadius = '50%';
  cursor.style.pointerEvents = 'none';
  cursor.style.zIndex = '10001';
  document.body.appendChild(cursor);
}

async function main() {
  video = await initCamera();
  if (!video) return;
  detector = await loadModel();
  if (!detector) return;
  createCursor();
  continueDetection();
}

main();
