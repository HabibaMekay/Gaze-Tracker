let smoothedX = 0, smoothedY = 0;
const SMOOTHING = 0.8; // for smooth cursor movement
const GAZE_SENSITIVITY_X = 2.2; 
const GAZE_SENSITIVITY_Y = 13; 
const CONFIDENCE_THRESHOLD = 0.94; // Relaxed for robustness
let baselineGaze = null;
let video = null, canvas = null, cursor = null, detector = null;
let initialFrames = [];
const INITIAL_FRAME_COUNT = 30; // Average first 30 frames for baseline
let testPointsVisible = false;

// Dual-stage Kalman filter for smoothing
class KalmanFilter {
  constructor(processNoise = 0.001, measurementNoise = 0.01, errorCov = 1) {
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
    console.error('getUserMedia not supported');
    alert('This browser does not support webcam access. Use Chrome or Firefox.');
    return null;
  }

  video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.style.position = 'fixed';
  video.style.top = '10px';
  video.style.right = '10px';
  video.style.width = '240px';
  video.style.height = '180px';
  video.style.transform = 'scaleX(-1)';
  video.style.zIndex = '9999';
  video.style.border = '2px solid blue';
  video.style.display = 'block';
  document.body.appendChild(video);

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
    alert('Failed to access webcam. Check permissions and ensure a webcam is connected.');
    return null;
  }
}

async function loadModel() {
  if (!window.faceLandmarksDetection) {
    const script = document.createElement('script');
    const cdnUrls = [
      'https://cdn.jsdelivr.net/npm/@mediapipe/face_landmarks_detection@0.6',
      'https://cdn.jsdelivr.net/npm/@mediapipe/face_landmarks_detection@0.5.1'
    ];
    for (const url of cdnUrls) {
      try {
        script.src = url;
        document.head.appendChild(script);
        await new Promise((resolve, reject) => {
          script.onload = () => {
            console.log(`MediaPipe script loaded from ${url}`);
            resolve();
          };
          script.onerror = () => reject(new Error(`Failed to load MediaPipe from ${url}`));
        });
        break;
      } catch (error) {
        console.warn(error.message);
        if (url === cdnUrls[cdnUrls.length - 1]) {
          alert('Failed to load MediaPipe script from all sources. Check internet or browser.');
          throw error;
        }
      }
    }
  }

  const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
  const detectorConfig = {
    runtime: 'mediapipe',
    solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
    maxFaces: 1,
    refineLandmarks: true
  };

  try {
    detector = await faceLandmarksDetection.createDetector(model, detectorConfig);
    console.log('MediaPipe Face Mesh detector created');
    return detector;
  } catch (error) {
    console.error('Model loading error:', error.message);
    alert('Failed to load gaze tracking model. Check console for details.');
    return null;
  }
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
    rightEyeIris.confidence < CONFIDENCE_THRESHOLD ||
    leftEyeInnerCorner.confidence < CONFIDENCE_THRESHOLD ||
    rightEyeInnerCorner.confidence < CONFIDENCE_THRESHOLD ||
    leftEyeOuterCorner.confidence < CONFIDENCE_THRESHOLD ||
    rightEyeOuterCorner.confidence < CONFIDENCE_THRESHOLD ||
    leftEyelid.confidence < CONFIDENCE_THRESHOLD ||
    rightEyelid.confidence < CONFIDENCE_THRESHOLD
  ) {
    console.warn('Low-confidence or missing landmarks');
    return null;
  }


  const eyeCenter = {
    x: (leftEyeInnerCorner.x + rightEyeInnerCorner.x + leftEyeOuterCorner.x + rightEyeOuterCorner.x + leftEyelid.x + rightEyelid.x) / 6,
    y: (leftEyeInnerCorner.y + rightEyeInnerCorner.y + leftEyeOuterCorner.y + rightEyeOuterCorner.y + leftEyelid.y + rightEyelid.y) / 6
  };
  const irisCenter = {
    x: (leftEyeIris.x + rightEyeIris.x) / 2,
    y: (leftEyeIris.y + rightEyeIris.y) / 2
  };

  // Normalize gaze vector
  const L = calculateDistance(leftEyeInnerCorner, rightEyeInnerCorner);
  const H = calculateDistance(leftEyeInnerCorner, leftEyelid);
  const gazeVector = {
    x: (irisCenter.x - eyeCenter.x) / L,
    y: (irisCenter.y - eyeCenter.y) / H
  };

  // Minimal head pose compensation
  const headYaw = Math.atan2(
    rightEyeInnerCorner.x - leftEyeInnerCorner.x,
    rightEyeInnerCorner.y - leftEyeInnerCorner.y
  ) * 180 / Math.PI;
  const headPitch = Math.atan2(
    (leftEyeInnerCorner.y + rightEyeInnerCorner.y) / 2 - landmarks[2].y,
    L
  ) * 180 / Math.PI;

  // Barely adjust for head pose
  const adjustedGaze = {
    x: gazeVector.x - 0.0015 * headYaw,
    y: gazeVector.y - 0.0015 * headPitch
  };

  // Dynamic sensitivity
  const faceDistance = L * 2;
  const distanceScale = Math.min(2.5, 2000 / faceDistance);
  const gaze = {
    x: -adjustedGaze.x * 0.75 * distanceScale,
    y: adjustedGaze.y * 0.85 * distanceScale
  };

  return gaze;
}

function checkLighting(video, canvas) {
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, 1, 1);
  const pixel = ctx.getImageData(0, 0, 1, 1).data;
  const brightness = (pixel[0] + pixel[1] + pixel[2]) / 3;
  if (brightness < 40) {
    console.warn('Lighting too dark (brightness:', brightness.toFixed(1), '). Add a lamp or increase room lighting.');
    alert('Lighting is too dark (brightness: ' + brightness.toFixed(1) + '). Add a lamp or increase room lighting.');
    return false;
  } else if (brightness > 220) {
    console.warn('Lighting too bright (brightness:', brightness.toFixed(1), '). Dim lights or avoid direct light sources.');
    alert('Lighting is too bright (brightness: ' + brightness.toFixed(1) + '). Dim lights or avoid direct light sources.');
    return false;
  }
  console.log('Lighting OK (brightness:', brightness.toFixed(1), ')');
  return true;
}



async function continueDetection() {
  if (!video || !detector || !canvas || !cursor) {
    console.error('Missing required elements:', { video, detector, canvas, cursor });
    alert('Gaze tracking failed: missing required elements. Check console.');
    return;
  }

  const faces = await detector.estimateFaces(video);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!checkLighting(video, canvas)) {
    requestAnimationFrame(continueDetection);
    return;
  }

  if (faces.length > 0) {
    const keypoints = faces[0].keypoints;

    // Draw iris markers
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    [keypoints[477], keypoints[472]].forEach(iris => {
      if (iris ){//&& iris.confidence > CONFIDENCE_THRESHOLD) {
        ctx.beginPath();
        ctx.arc(iris.x, iris.y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = 'red';
        ctx.fill();
        ctx.closePath();
      }
    });
    ctx.restore();

    const gaze = estimateGaze(keypoints);
    if (!gaze) {
      console.log('Skipping frame due to low-confidence landmarks');
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
        console.log('Baseline gaze set (calibration-free):', baselineGaze);
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

    const MAX_PIXELS_X = window.innerWidth;
    const MAX_PIXELS_Y = window.innerHeight;
    const dx = smoothedX * MAX_PIXELS_X * GAZE_SENSITIVITY_X;
    const dy = smoothedY * MAX_PIXELS_Y * GAZE_SENSITIVITY_Y;

    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const rawX = centerX + dx - cursor.offsetWidth / 2;
    const rawY = centerY + dy - cursor.offsetHeight / 2;

    const maxX = window.innerWidth - cursor.offsetWidth / 2;
    const maxY = window.innerHeight - cursor.offsetHeight / 2;
    const minX = 0 - cursor.offsetWidth / 2;
    const minY = 0 - cursor.offsetHeight / 2;

    const clampedX = Math.min(Math.max(rawX, minX), maxX);
    const clampedY = Math.min(Math.max(rawY, minY), maxY);

    cursor.style.left = `${clampedX}px`;
    cursor.style.top = `${clampedY}px`;


    console.log('Gaze:', gaze, 'Smoothed:', { x: smoothedX.toFixed(3), y: smoothedY.toFixed(3) }, 'Cursor:', { x: clampedX.toFixed(1), y: clampedY.toFixed(1) });
  } else {
    console.log('No face detected');
  }

  requestAnimationFrame(continueDetection);
}

function calculateDistance(pointA, pointB) {
  return Math.sqrt(Math.pow(pointB.x - pointA.x, 2) + Math.pow(pointB.y - pointA.y, 2));
}

function createCanvas(video) {
  canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.style.position = 'fixed';
  canvas.style.top = video.style.top;
  canvas.style.right = video.style.right;
  canvas.style.zIndex = '9998';
  canvas.style.pointerEvents = 'none';
  canvas.style.width = video.style.width;
  canvas.style.height = video.style.height;
  canvas.style.border = '2px solid red';
  canvas.style.display = 'block';
  document.body.appendChild(canvas);
  return canvas;
}

function createCursor() {
  cursor = document.createElement('div');
  cursor.style.position = 'fixed';
  cursor.style.width = '12px';
  cursor.style.height = '12px';
  cursor.style.backgroundColor = 'red';
  cursor.style.borderRadius = '50%';
  cursor.style.pointerEvents = 'none';
  cursor.style.zIndex = '9999';
  document.body.appendChild(cursor);
  return cursor;
}

async function main() {
  video = await initCamera();
  if (!video) return;

  canvas = createCanvas(video);
  detector = await loadModel();
  if (!detector) return;

  cursor = createCursor();
  continueDetection();
}

main();