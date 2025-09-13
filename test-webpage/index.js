let smoothedX = 0, smoothedY = 0;// store the last smoothed gaze position
const SMOOTHING = 0.1;  ///make this bigger to move the dot more quickly (lighter gaze movements)//// smaller to make it more stable and slow
let baselineVy = null;
const GAZE_SENSITIVITY_X = 0.7;  // Horizontal sensitivity
const GAZE_SENSITIVITY_Y = 1.2; // Higher vertical sensitivity
const AMPLIFY_RIGHT = 15, AMPLIFY_LEFT = 8; // reversed
const AMPLIFY_UP = 34, AMPLIFY_DOWN = 15;
let baselineFrameCount = 0; // Count frames for baseline adjustment
const BASELINE_MAX_FRAMES = 600; // Maximum frames to adjust baseline
const BASELINE_UPDATE_THRESHOLD = 0.005;//ignore head movements that are too large to avoid adjusting the baseline too frequently
let baselineVx = null;
let minVx =  Infinity, maxVx = -Infinity;
let minVy =  Infinity, maxVy = -Infinity;
const collectedData = []; // This is where we will save gaze data
let currentCalibrationTarget = null; // Current red dot position
let isCollecting = false; // Whether we are currently collecting data
let taskCompletions = 0;
let errors = 0;
let frozenCaptureX = null;
let frozenCaptureY = null;
let wasMouthOpen = false; // for magnifier toggle
let isZoomed = false; // Tracks zoom state (false = normal, true = zoomed in)
let zoomLevel = 1; // Current zoom level (1 = normal, >1 = zoomed in)
const ZOOM_IN_LEVEL = 3; // Zoom-in scale (e.g., 2x magnification)
const ZOOM_OUT_LEVEL = 1; // Zoom-out scale (returns to normal view)
const ZOOM_TRANSITION = 'transform 0.3s ease'; // Smooth CSS transition for zoom effects

const SCROLL_ZONE_HEIGHT = 0.1; // 10% OF the screen height for scroll zones
const MAX_SCROLL_SPEED = 5; // max scroll speed (when I increased it became shaky)
const SCROLL_DWELL_THRESHOLD = 800; // Time in milliseconds to start scrolling after dwelling in a scroll zone
const NEUTRAL_ZONE_HEIGHT = 0.8; // safe no scroll zone in the middle of the screen
let scrollDwellStart = null;// start time for scrolling
let scrollDirection = null;  // direction of scrolling

const BASELINE_WINDOW_MS = 10000; // 10 seconds window for baseline calculation
const baselineSamples = []; // Store recent baseline samples

navigator.mediaDevices.getUserMedia({ // increase the video resolution to improve gaze tracking accuracy
  video: { width: 1280, height: 720 },
  facingMode: "user" // Use the front camera
})
let heatCanvas, heatCtx;
function createHeatMapLayer() { // Create a canvas for the heatmap layer for detecting patterns in gaze movements
  heatCanvas = document.createElement('canvas');
  heatCanvas.width  = window.innerWidth;
  heatCanvas.height = window.innerHeight;

  Object.assign(heatCanvas.style, {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    pointerEvents: 'none',
    zIndex: 1500  // Ensure it appears above other content
  });
  document.body.appendChild(heatCanvas);
  heatCtx = heatCanvas.getContext('2d');
}
let activeElement = null; // Tracks the currently focused element
let dwellStartTime = null; // Tracks when dwell started
const dwellThreshold = 800; // Dwell time threshold in milliseconds (1 second)

function ContextualScore(gazeX, gazeY) {
    const elements = document.querySelectorAll("button, input, textarea, a, .virtual-key, [role='button'], [role='link'], [role='textbox']");
    const candidates = [];

    elements.forEach(element => {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Skip non-actionable hna
        if (
            rect.width === 0 ||
            rect.height === 0 ||
            getComputedStyle(element).visibility === 'hidden' ||
            getComputedStyle(element).display === 'none' ||
            element.disabled ||
            element.readOnly ||
            element.getAttribute('aria-disabled') === 'true' ||
            element.getAttribute('aria-hidden') === 'true'
        ) {
            return;
        }

        const distance = Math.sqrt((centerX - gazeX) ** 2 + (centerY - gazeY) ** 2);
        const sizeFactor = Math.min(rect.width * rect.height / 10000, 1);
        const distanceScore = Math.max(0, 1 - distance / 400);

        let typeScore = 0;
        const tag = element.tagName.toLowerCase();
        if (tag === 'button' || element.getAttribute("role") === "button") typeScore = 1.2;
        else if (tag === 'input' || tag === 'textarea' || element.getAttribute("role") === "textbox") typeScore = 1.3;
        else if (tag === 'a' || element.getAttribute("role") === "link") typeScore = 1.0;
        else if (element.classList.contains('virtual-key')) { typeScore =1.1}
    
        else typeScore = 0.5;
        let totalScore;
        if (element.classList.contains('virtual-key') && (element.textContent.trim() === '_________________________________________')) {
        if (distance < 100) { ////adjust////////
            totalScore = 0.7; // Only allow if gaze is right on top 
        } else {
            totalScore = 0;
        }
        } else {
            totalScore = distanceScore * typeScore * sizeFactor;
        }

            if (totalScore > 0.1) {
                candidates.push({ element, score: totalScore, distance, centerX, centerY });
            }
    });

    //  take top 3
    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 3);
}

let previousHighlights = [];

function highlightCandidates(candidates) {
    // Clear previous highlights
    previousHighlights.forEach(({ element, originalStyle }) => {
        element.style.border = originalStyle.border;
        element.style.boxShadow = originalStyle.boxShadow;
    });
    previousHighlights = [];

    // Highlight new candidates
    candidates.forEach(({ element }, index) => {
        const originalStyle = {
            border: element.style.border,
            boxShadow: element.style.boxShadow
        };
        // Stronger highlight for the top candidate
        element.style.border = index === 0 ? '3px solid #ff0000' : '2px solid #ffa500';
        element.style.boxShadow = index === 0 ? '0 0 10px #ff0000' : '0 0 5px #ffa500';
        previousHighlights.push({ element, originalStyle });
    });
}



let pressTimer = 0;
let pressInterval = null;
const pressTimerThreshold = 500;// 0.5 sec 
let isPressingFeedback = null;

function pressVisualFeedback(btn, onComplete) {
    stopPressing(); // reset before starting :)
    pressTimer=0;

    isPressingFeedback = document.createElement('div');
    isPressingFeedback.style.position = 'absolute';
    isPressingFeedback.style.width = '100%';
    isPressingFeedback.style.height = '100%';
    isPressingFeedback.style.top = '0';
    isPressingFeedback.style.left = '0';
    isPressingFeedback.style.borderRadius = '999px';
    isPressingFeedback.style.background = `linear-gradient(to right, rgba(76, 175, 80, 0.1) 0%, transparent 100%)`;
    isPressingFeedback.style.zIndex = '3000';
    isPressingFeedback.style.pointerEvents = 'none'; // to not block clicks
    btn.style.position = 'relative';
    btn.appendChild(isPressingFeedback);

    pressInterval = setInterval(() => {
        pressTimer += 25; // increment every 100ms
        let progress = (pressTimer/pressTimerThreshold) * 100; // calculate progress percentage
        isPressingFeedback.style.background = `linear-gradient(to right, rgba(76, 175, 80, 0.5) ${progress}%, transparent ${progress}%)`;
        if (pressTimer >= pressTimerThreshold) {
            clearInterval(pressInterval);
            pressInterval = null;
            stopPressing()
            if (typeof onComplete === 'function') {
                onComplete();
            }
        }
    }, 25); // update every 100ms
}

function stopPressing() {
    if (pressInterval) {
        clearInterval(pressInterval);
        pressInterval = null;
    }
    if (isPressingFeedback) {
        isPressingFeedback.remove();
        isPressingFeedback = null;
    }
}







function showVirtualKeyboard(targetInput) {
    let existingKeyboard = document.getElementById('virtual-keyboard');
    if (existingKeyboard) existingKeyboard.remove();

    let isUppercase = true;

    const keyboard = document.createElement('div');
    keyboard.id = 'virtual-keyboard';
    keyboard.style.position = 'fixed';
    keyboard.style.bottom = '10px';
    keyboard.style.left = '50%';
    keyboard.style.transform = 'translateX(-50%)';
    keyboard.style.background = '#fff';
    keyboard.style.border = '1px solid #ccc';
    keyboard.style.padding = '10px';
    keyboard.style.zIndex = '1000';
    keyboard.style.boxShadow = '0 0 10px rgba(0,0,0,0.3)';
    keyboard.style.borderRadius = '10px';
    keyboard.style.width = '80%';

    const topBar = document.createElement('div');
    topBar.style.display = 'flex';
    topBar.style.justifyContent = 'flex-end';
    topBar.style.marginBottom = '15px';

    const closeButton = document.createElement('button');
    closeButton.textContent = 'X';
    closeButton.classList.add('virtual-key');
    closeButton.style.padding = '20px 40px';
    closeButton.style.fontSize = '20px';
    closeButton.style.borderRadius = '999px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.border = '1px solid #888';
    closeButton.style.maxWidth ='120px'
    closeButton.style.height = '70px'
    closeButton.style.width =   '150px';
    closeButton.style.background = '#f2f2f2';
    closeButton.addEventListener('click', () => keyboard.remove());
    topBar.appendChild(closeButton);
    keyboard.appendChild(topBar);

    const rows = [
        ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '←'],
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['⬆', 'Z', 'X', 'C', 'V', 'B', 'N', 'M'],
        ['Space']
    ];

    const keyButtons = [];

    rows.forEach((row, rowIndex) => {
        const rowDiv = document.createElement('div');
        rowDiv.style.display = 'flex';
        rowDiv.style.justifyContent = 'space-between';
        rowDiv.style.marginBottom = '20px';
        rowDiv.style.gap ='10px';

        row.forEach(key => {
            const btn = document.createElement('button');
            const isLetter = /^[A-Z]$/.test(key);

            if (key === 'Space') {
                btn.textContent = '_______________________________________';
                btn.style.width = '1200px'; 
                // btn.style.flex = '4';
                rowDiv.style.justifyContent = 'center'; 
                

            // } else if (isLetter) {

                

            } else {
                btn.textContent = key;
                btn.textContent = isUppercase ? key : key.toLowerCase();
                btn.style.flex = '2';
                btn.style.maxWidth = '120px';
            }

            btn.classList.add('virtual-key');
            // btn.style.padding = key === 'Space' ? '10px 80px' : '10px 14px';
            btn.style.height = '80px'
            btn.style.margin = '3px';
            btn.style.fontSize = '25px';
            btn.style.cursor = 'pointer';
            btn.style.border = '1px solid #888';
            btn.style.borderRadius = '999px'; //rounded keys
            btn.style.background = '#f2f2f2';
            

            btn.addEventListener('click', () => {
                if (key === '⬆') {
                    isUppercase = !isUppercase;
                    updateKeyLabels();
                } else if (key === '←') {
                    targetInput.value = targetInput.value.slice(0, -1);
                } else if (key === 'Space') {
                    targetInput.value += ' ';
                } else {
                    const value = /^[A-Z]$/.test(key)
                        ? (isUppercase ? key : key.toLowerCase())
                        : key;
                    targetInput.value += value;
                }
                targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            });

            if (isLetter) keyButtons.push({ btn, key });
            rowDiv.appendChild(btn);
        });

        keyboard.appendChild(rowDiv);
    });

    function updateKeyLabels() {
        keyButtons.forEach(({ btn, key }) => {
            btn.textContent = isUppercase ? key : key.toLowerCase();
        });
    }

    document.body.appendChild(keyboard);
}


async function camera(){
    // Check if the browser supports the getUserMedia API
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {

// Create a video element to display the camera feed
    const video = document.createElement('video');
    video.autoplay = true; // Automatically play the video
    video.style.position = 'fixed';  
    video.playsInline = true; 
    video.style.top = '20px';
    video.style.left = '700px'; 
    video.style.width = '320px';
    video.style.height = '270px';
    video.style.transform = 'scaleX(-1)'; // Mirror the video horizontally
    video.style.zIndex = '1000'; // Ensure it appears above other content
 
    document.body.appendChild(video); // Append the video element to the body
        try {
        // Request access to the camera
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        // Get the video element
        video.srcObject = stream;

        // Wait for the video to be ready
             await new Promise(resolve => {
                if (video.readyState >= 2) return resolve(); // 2 is have metadata -> the video has loaded enogh metadata to get width and height
                video.onloadedmetadata = () => resolve(); // if not ready, wait for metadata to load
            });

        return video; 
        } catch (error) {
        console.error('Error accessing the camera:', error);
        }
    } else {
     
     
        console.error('getUserMedia is not supported in this browser.');
    }
}


// load the MediaPipe Face Mesh model

async function loadmodel() {

    const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;

    const detectorConfig = {
    runtime: 'mediapipe', 
    solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
    maxFaces: 1, // Maximum number of faces to detect
    refineLandmarks: true, // Whether to refine the landmarks
    modelType: 'full' // Use the full model for more accurate detection
    }

    const detector = await faceLandmarksDetection.createDetector(model, detectorConfig);    

  
     console.log("Model loaded successfully");
     return detector; 


    
}




function drawCircleFrame(ctx, nosetip,leftEyeInnerCorner, rightEyeInnerCorner, canvas) {


    const distanceForCicrleFrame = calculateDistance(leftEyeInnerCorner,rightEyeInnerCorner);
    const radius = distanceForCicrleFrame * 2; // Calculate the radius of the circle based on the distance between the inner corners of the eyes
    const headFrameCenter = {
        x: canvas.width / 2, // Center of the canvas
        y: canvas.height / 2 
    };

   const noseOffsetX = nosetip.x - headFrameCenter.x; // how far is nose from center of the frame
   const noseOffsetY = nosetip.y - headFrameCenter.y;
   const distanceFromCenter = Math.sqrt(noseOffsetX * noseOffsetX + noseOffsetY * noseOffsetY); // Calculate the distance from the center of the frame to the nose tip
   const isInsideFrame = distanceFromCenter <= radius; 
    
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.lineWidth = 3;
    ctx.strokeStyle = isInsideFrame ? 'lime' : 'red';
    ctx.beginPath();
    ctx.arc(headFrameCenter.x, headFrameCenter.y, radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();

    return isInsideFrame;
    
}






// Start detecting the face in the video stream
//  canvas is implmented after this function dont be confused :)
// function to check if iris shape is valid
function isIrisShapeValid(iris) { //check if the iris shape is valid (circular enough) to get a relaible gaze direction
    const distances = [];
    for (let i = 0; i < iris.length; i++) {
        for (let j = i + 1; j < iris.length; j++) {
            const dx = iris[i].x - iris[j].x;
            const dy = iris[i].y - iris[j].y;
            distances.push(Math.sqrt(dx * dx + dy * dy));
        }
    }
    const maxDist = Math.max(...distances);// Get the maximum distance between any two points in the iris
    const minDist = Math.min(...distances);
    return (maxDist / minDist < 2.5); // Check if the ratio of max to min distance is within a threshold (2.5)
}

// function to draw iris centers on canvas
function drawIrisCenters(ctx, leftEyeIris, rightEyeIris, canvas) {
    // Mirror drawing to match video
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);

    [leftEyeIris, rightEyeIris].forEach(iris => {
        ctx.beginPath();
        ctx.arc(iris.x, iris.y, 5, 0, 2 * Math.PI); // draw a circle around the iris center
        ctx.fillStyle = 'red';
        ctx.fill();
        ctx.closePath();
    });
    ctx.restore();
}

// function to calculate centers
function calculateCenters(keypoints) {
    // where eye is located, to measure if the eye is looking inward or outward aka left or right
    const leftEyeInnerCorner = keypoints[133];
    const leftEyeOuterCorner = keypoints[33];
    const rightEyeInnerCorner = keypoints[362];
    const rightEyeOuterCorner = keypoints[263];

    // Pc = Pl_corner + Pr_corner
    // Pl_corner and pr_corner stand for the located left eye inner corner and right eye inner corner
    const cornerCenter = {
        x: (leftEyeInnerCorner.x + rightEyeInnerCorner.x) / 2,
        y: (leftEyeInnerCorner.y + rightEyeInnerCorner.y) / 2
    };

    // Iris centers: tells where the pupil is pointing
    const leftEyeIris = keypoints[472]; // Left eye iris center
    const rightEyeIris = keypoints[477]; // Right eye iris center

    // PI = Pl_iris + Pr_iris
    // Pl_iris and Pr_iris stand for the located left and right iris centers, respectively
    const irisCenter = {
        x: (leftEyeIris.x + rightEyeIris.x) / 2,
        y: (leftEyeIris.y + rightEyeIris.y) / 2
    };

    return { cornerCenter, irisCenter, leftEyeInnerCorner, rightEyeInnerCorner, leftEyeIris, rightEyeIris };
}

// function to calculate gaze vector
function calculateGazeVector(irisCenter, cornerCenter) {
    // Vg = PI - Pc
    // Vg is the gaze vector, which is the vector from the center of the eyes
    return {
        x: irisCenter.x - cornerCenter.x,
        y: irisCenter.y - cornerCenter.y
    };
}

// function to normalize gaze vector
function normalizeGazeVector(gazeVector, keypoints) {
    // here we are going to normalize to remove scale dependency (gaze estimation will be independent of face size and zoom)
    // also to handle head movements, to make sure features are usable for mapping to screen coordinates
    // analogy: to know where someone is pointing according to their height, a child vs an adult can point in the same direction but at different heights
    const leftEyeInnerCorner = keypoints[133];
    const rightEyeInnerCorner = keypoints[362];

    // Vx = Vg.x / L -> L is the distance between eye corners
    const L = calculateDistance(leftEyeInnerCorner, rightEyeInnerCorner);
    const Vx = gazeVector.x / L; // Normalize the x component of the gaze vector

    // Vy = Vg.y / H -> H is the nose bridge height
    const noseBridge = keypoints[168];
    const nosetip = keypoints[2];
    const H = Math.max(0.001, calculateDistance(noseBridge, nosetip)); // Calculate the height of the nose bridge//how close the head is to the camera, to avoid division by zero
    const Vy = gazeVector.y / H; // Normalize the y component of the gaze vector
    //////////////////////////////////////idk is this better or not but it seems to work better ////////////////////////////////
    // adjust the gaze vector based on the tilt of the head
    const tiltAngle = Math.atan2(rightEyeInnerCorner.y - leftEyeInnerCorner.y, rightEyeInnerCorner.x - leftEyeInnerCorner.x); // Calculate the tilt angle of the head based on the eye corners
    const adjustedVx = Vx * Math.cos(tiltAngle) + Vy * Math.sin(tiltAngle); // adjust the x component of the gaze vector based on the tilt angle
    const adjustedVy = Vy * Math.cos(tiltAngle) - Vx * Math.sin(tiltAngle); //

    return { Vx: adjustedVx, Vy: adjustedVy, L, H, noseBridge, nosetip,noseX: nosetip.x, noseY: nosetip.y  };
}

// function to update baseline
function updateBaseline(Vx, Vy, noseX, noseY) { // Update the baseline gaze vector based on stable head position over time
    const timestamp = performance.now(); // Use performance.now() for timestamp in milliseconds
    baselineSamples.push({ Vx, Vy, timestamp, noseX, noseY }); // Add the new sample to the list / it is like a sliding window for the last 10 seconds

    // remove samples older than 10 seconds
    while (baselineSamples.length && timestamp - baselineSamples[0].timestamp > BASELINE_WINDOW_MS) { // 10 seconds window
        baselineSamples.shift(); // remove old samples
    }

    // only use samples where head is stable (nose movement within threshold)
    if (baselineSamples.length > 1) { // need at least 2 samples to compare
        const recentSample = baselineSamples[baselineSamples.length - 1]; // most recent sample
        const prevSample = baselineSamples[baselineSamples.length - 2]; // previous sample
        const noseMovement = Math.sqrt(// calculate nose movement between the two most recent samples
            Math.pow(recentSample.noseX - prevSample.noseX, 2) + 
            Math.pow(recentSample.noseY - prevSample.noseY, 2)
        );
        if (noseMovement > BASELINE_UPDATE_THRESHOLD * 100) {  // if nose moved more than threshold
            return; // Skip if head moved too much
        }
    }

    // calculate average Vx, Vy from stable samples
    if (baselineSamples.length > 10) { // need at least 10 samples to calculate a reliable baseline
        let sumVx = 0, sumVy = 0, count = 0;
        for (const sample of baselineSamples) { // average the Vx and Vy values
            sumVx += sample.Vx;
            sumVy += sample.Vy;
            count++;
        }
        baselineVx = sumVx / count; // update the baseline values
        baselineVy = sumVy / count;
    }
}

// function to center and amplify gaze
function centerAndAmplify(Vx, Vy) {
    // screen's Y axis is 0 at the top and increases downwards // look down Vy-> increases and vice versa
    const centeredVx = baselineVx !== null ? Vx - baselineVx : Vx; // Center the gaze vector by subtracting the baseline
    const centeredVy = baselineVy !== null ? Vy - baselineVy : Vy; 

    const amplifiedVx = centeredVx < 0 ? centeredVx * AMPLIFY_LEFT : centeredVx * AMPLIFY_RIGHT;
    const amplifiedVy = centeredVy < 0 ? centeredVy * AMPLIFY_UP : centeredVy * AMPLIFY_DOWN;

    const normalizedGazeVector = {
        x: -amplifiedVx,
        y: -amplifiedVy // Invert x because the video is mirrored, y is inverted to match the screen coordinate system
    };

    return normalizedGazeVector;
}

// soft sigmoid function
function softSigmoid(v, gain) { // Soft sigmoid function to map gaze values to screen movement // higher gain means less sensitivity, lower gain means more sensitivity
    // maps -1…+1 to ~-1…+1 but flattens near 0
    return v / (1 + Math.abs(v) * gain);
}

// function to collect calibration data
function collectCalibrationData(leftEyeIris, rightEyeIris, video) {
    // If we are collecting data and have a calibration target(red dot)
    if (isCollecting && currentCalibrationTarget) {
        const timestamp = Date.now(); // Get the current timestamp
        const videoWidth = video.videoWidth; // Get the video width to normalize coordinates to
        const videoHeight = video.videoHeight; // Get the video height

        const sample = {
            timestamp,
            left_iris_x: (leftEyeIris.x / videoWidth).toFixed(5),
            left_iris_y: (leftEyeIris.y / videoHeight).toFixed(5),
            right_iris_x: (rightEyeIris.x / videoWidth).toFixed(5),
            right_iris_y: (rightEyeIris.y / videoHeight).toFixed(5),
            gaze_x: currentCalibrationTarget.x.toFixed(0),
            gaze_y: currentCalibrationTarget.y.toFixed(0),
            screen_width: window.innerWidth,
            screen_height: window.innerHeight,
            target_x: currentCalibrationTarget.x,
            target_y: currentCalibrationTarget.y
        };

        collectedData.push(sample); // Add the sample to the collected data array
    }
}

// function to position cursor
function positionCursor(dx, dy, cursor) {
    const centerX = window.innerWidth / 2; // center of the screen
    const centerY = window.innerHeight / 2;

    const rawX = centerX + dx - cursor.offsetWidth / 2; // takes the center of the screen and adds the gaze movement, then centers the cursor because the cursor is positioned at the top left corner
    const rawY = centerY + dy - cursor.offsetHeight / 2;

    const maxX = window.innerWidth - cursor.offsetWidth / 2; // subtract half the cursor width so, the dot’s center is placed at the eye's target, not its corner
    const maxY = window.innerHeight - cursor.offsetHeight / 2;
    const minX = 0 - cursor.offsetWidth / 2; // to make sure the cursor does not go off screen
    const minY = 0 - cursor.offsetHeight / 2;
    const clampedX = Math.min(Math.max(rawX, minX), maxX); // clamps the x coordinate to be within the screen bounds
    const clampedY = Math.min(Math.max(rawY, minY), maxY); // if too high or too low, it will be set to the max or min value

    cursor.style.left = `${clampedX}px`; // takes the clamped x and y coordinates and sets the cursor position
    cursor.style.top = `${clampedY}px`;

    return { clampedX, clampedY };
}


function applyZoom(scale, cursorX, cursorY) {
  const body = document.body;
  body.style.transform = `scale(${scale})`;
  body.style.transformOrigin = `${cursorX}px ${cursorY}px`;
  body.style.transition = ZOOM_TRANSITION;
  zoomLevel = scale;
  isZoomed = scale > 1;
}


// function to handle interactions (dwell, click, scroll)
function handleInteractions(clampedX, clampedY, cursor) {
    // Only interact when not calibrating
    if (isCollecting) return;

    const candidates = ContextualScore(clampedX, clampedY);
    highlightCandidates(candidates);

    let closestElement = null;
    let closestDistance = Infinity;

    if (candidates.length > 0) {
        closestElement = candidates[0].element;
        closestDistance = candidates[0].distance;
    }

    if (closestElement && closestDistance < 120) {
        const tag = closestElement.tagName.toLowerCase();
        if (activeElement === closestElement) {
            const dwellTime = Date.now() - dwellStartTime;
            console.log(`Dwell progress: ${dwellTime}`);
            if (closestElement.classList.contains('virtual-key') && !isPressingFeedback) {
                // start visual feedback for virtual keys
                pressVisualFeedback(closestElement, () => {
                    closestElement.click();
                });
            }
            if (dwellTime >= dwellThreshold && !closestElement.classList.contains('virtual-key')) {
                console.log(`Dwell progress REACHED`);
                taskCompletions++;
                if (tag === "button" || closestElement.getAttribute("role") === "button") {
                    console.log("Button clicked via gaze");
                    closestElement.click();
                } else if (tag === "input" || tag === "textarea" || closestElement.getAttribute("role") === "textbox") {
                    console.log("Text input focused via gaze");
                    closestElement.focus();
                    showVirtualKeyboard(closestElement);
                } else if (tag === "a" || closestElement.getAttribute("role") === "link") {
                    console.log("Link clicked via gaze");
                    closestElement.click();
                }
                dwellStartTime = null;
                activeElement = null;
            }
        } else {
            activeElement = closestElement;
            dwellStartTime = Date.now();
            stopPressing();
        }
    } else {
        if (closestDistance > 120) errors++;
        dwellStartTime = null;
        activeElement = null;
        stopPressing(); 
    }

    // scroll only if not dwelling on an element
    if (!activeElement) { // if no element is active, we can scroll
        const cursorCenterY = clampedY + cursor.offsetHeight / 2;
        const scrollZoneSize = window.innerHeight * SCROLL_ZONE_HEIGHT;
        const neutralZoneStart = window.innerHeight * (0.5 - NEUTRAL_ZONE_HEIGHT / 2);
        const neutralZoneEnd = window.innerHeight * (0.5 + NEUTRAL_ZONE_HEIGHT / 2);

        let scrollSpeed = 0;
        if (cursorCenterY < scrollZoneSize) {
            if (scrollDirection !== 'up') {
                scrollDwellStart = Date.now();
                scrollDirection = 'up';
            }
            const scrollDwellTime = Date.now() - scrollDwellStart;
            if (scrollDwellTime >= SCROLL_DWELL_THRESHOLD) { // if enough time has passed in the scroll zone(pass)
                const depth = (scrollZoneSize - cursorCenterY) / scrollZoneSize;
                scrollSpeed = -MAX_SCROLL_SPEED * depth;
                window.scrollBy(0, scrollSpeed);
            }
        } else if (cursorCenterY > window.innerHeight - scrollZoneSize) {
            if (scrollDirection !== 'down') {
                scrollDwellStart = Date.now();
                scrollDirection = 'down';
            }
            const scrollDwellTime = Date.now() - scrollDwellStart;
            if (scrollDwellTime >= SCROLL_DWELL_THRESHOLD) {
                const depth = (cursorCenterY - (window.innerHeight - scrollZoneSize)) / scrollZoneSize;
                scrollSpeed = MAX_SCROLL_SPEED * depth;
                window.scrollBy(0, scrollSpeed);
            }
        } else if (cursorCenterY >= neutralZoneStart && cursorCenterY <= neutralZoneEnd) {
            scrollDwellStart = null;
            scrollDirection = null;
        } else {
            scrollDwellStart = null;
            scrollDirection = null;
        }
    } else {
        scrollDwellStart = null;
        scrollDirection = null;
    }
}

// Add this helper
function isMouthOpen(keypoints) {
    // upper and lower inner lip
    const upperLip = keypoints[13]; 
    const lowerLip = keypoints[14];

    // distance between lips
    const mouthOpenDist = Math.abs(lowerLip.y - upperLip.y);

    // Normalize by face size (distance between eyes)
    const leftEye = keypoints[33];
    const rightEye = keypoints[263];
    const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);

    // If mouth gap is more than ~0.25 of eye distance, it's "open"
    return mouthOpenDist > eyeDist * 0.25;
}




function calculateEAR(eyePoints) {  // eyePoints: array of 6 landmarks per eye (e.g., for left: [33,133,159,145,158,153]) // calculates the Eye Aspect Ratio (EAR) for the given eye landmarks
    const vertical1 = calculateDistance(eyePoints[1], eyePoints[5]);
    const vertical2 = calculateDistance(eyePoints[2], eyePoints[4]);
    const horizontal = calculateDistance(eyePoints[0], eyePoints[3]);
    return (vertical1 + vertical2) / (2 * horizontal);
}


let predictedPositionsBuffer = []; // Buffer to store last N predicted positions
let calibrationResults = []; // Store calibration results

// main 
// async function refactored
async function continueDetection(video, detector, canvas, cursor) {
    const face = await detector.estimateFaces(video);
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear the canvas before drawing

    if (face.length > 0) {
        if (face[0].faceInViewConfidence !== undefined && face[0].faceInViewConfidence < 0.99) {
            console.warn("Low confidence — skipping frame"); // if confidence is low, skip the frame // maybe add a warning or make users refresh the page
            requestAnimationFrame(() => continueDetection(video, detector, canvas, cursor));
            return;
        }
        console.log('Face detected:', face[0]);

        const keypoints = face[0].keypoints; // Get the keypoints of the detected face
        // The model returns 478 (Keypoints) facial landmarks :
        // - Left eye iris landmarks: indices 468 to 472 (5 points)
        // - Right eye iris landmarks: indices 473 to 477 (5 points)
        // we are using them to estimate iris center or gaze direction
        const rightIrisPoints = [keypoints[473], keypoints[474], keypoints[475], keypoints[476], keypoints[477]]; // Right eye iris landmarks
        const leftIrisPoints = [keypoints[468], keypoints[469], keypoints[470], keypoints[471], keypoints[472]]; // Left eye iris landmarks

        
        const leftEAR = calculateEAR([keypoints[33], keypoints[160], keypoints[159], keypoints[133], keypoints[145], keypoints[144]]);  // Approximate left eye points
        const rightEAR = calculateEAR([keypoints[263], keypoints[387], keypoints[386], keypoints[362], keypoints[374], keypoints[373]]);
        if (leftEAR < 0.2 || rightEAR < 0.2) {
            console.warn("Blink detected — skipping frame"); // If the eye aspect ratio is too low, it indicates a blink, so we skip the frame
            requestAnimationFrame(() => continueDetection(video, detector, canvas, cursor));
            return;
        }

        if (!isIrisShapeValid(rightIrisPoints) || !isIrisShapeValid(leftIrisPoints)) { // if eye is not circleish skip the frame
            console.warn("Iris shape invalid — skipping frame");
            requestAnimationFrame(() => continueDetection(video, detector, canvas, cursor)); // Skip the frame if iris shape is not valid
            return;
        }

        const { cornerCenter, irisCenter, leftEyeInnerCorner, rightEyeInnerCorner, leftEyeIris, rightEyeIris } = calculateCenters(keypoints);

        drawIrisCenters(ctx, leftEyeIris, rightEyeIris, canvas);

        const gazeVector = calculateGazeVector(irisCenter, cornerCenter);
        const { Vx, Vy, L, H, noseBridge,nosetip, noseX,noseY} = normalizeGazeVector(gazeVector, keypoints); // normalize the gaze vector to remove scale dependency and handle head movements

        // For the head frame
        const isInsideHeadFrame = drawCircleFrame(ctx, nosetip, leftEyeInnerCorner, rightEyeInnerCorner, canvas);
        if (!isInsideHeadFrame) { // If the nose tip is outside the head frame, skip the frame
            console.warn("Nose tip outside head frame — skipping frame");
            requestAnimationFrame(() => continueDetection(video, detector, canvas, cursor));
            return;
        } // End of head frame

        // Debugging
        console.log('Left Eye Iris:', leftEyeIris);
        console.log('Right Eye Iris:', rightEyeIris);
        console.log('Left Eye Corner:', leftEyeInnerCorner);
        console.log('Right Eye Corner:', rightEyeInnerCorner);
        console.log('Nose Bridge:', noseBridge);
        console.log('Nose Tip:', nosetip);
        console.log('Raw Gaze Vector:', gazeVector);
        console.log('Eye corner distance L:', L.toFixed(3));
        console.log('Nose bridge height H:', H.toFixed(3));
        console.log('Normalized Vx:', Vx.toFixed(3), 'Normalized Vy:', Vy.toFixed(3));

        if (baselineFrameCount < BASELINE_MAX_FRAMES) { // Collect baseline data for the first N frames
            updateBaseline(Vx, Vy, noseX, noseY); // Update baseline only if head is stable
            baselineFrameCount++; 
        }

        const normalizedGazeVector = centerAndAmplify(Vx, Vy);
        console.log('Normalized Gaze Vector:', normalizedGazeVector);

        // Here we start to convert gaze to screen movement
        const MAX_PIXELS_X = window.innerWidth; // set the maximum pixels to the window width
        const MAX_PIXELS_Y = window.innerHeight; // set the maximum pixels to the window height
        console.log('Vx:', Vx.toFixed(3), 'Vy:', Vy.toFixed(3));

        // FOR THE TEMPORAL FILTERING
        const temporallySmoothed = temporalFilter(normalizedGazeVector.x, normalizedGazeVector.y);
        const smoothedX = temporallySmoothed.x;
        const smoothedY = temporallySmoothed.y;
        let dx = smoothedX * window.innerWidth * GAZE_SENSITIVITY_X;
        let dy = smoothedY * window.innerHeight * GAZE_SENSITIVITY_Y * -1; // Invert dy to match screen coordinates, where down is positive

        collectCalibrationData(leftEyeIris, rightEyeIris, video);

        console.log('SmoothedX:', smoothedX.toFixed(3), 'SmoothedY:', smoothedY.toFixed(3));

        const { clampedX, clampedY } = positionCursor(dx, dy, cursor);

       
        if (isCollecting) {
            predictedPositionsBuffer.push({ x: clampedX, y: clampedY }); // add current predicted position to buffer
        }

        console.log('dx (pixels):', dx.toFixed(1), 'dy (pixels):', dy.toFixed(1));
        console.log('Cursor screen position:', { x: clampedX.toFixed(1), y: clampedY.toFixed(1) });

//        if (isMouthOpen(keypoints)) {
//     if (!magnifierActive) {
//         magnifier = createMagnifier();
//         magnifierCtx = magnifier.getContext('2d');

//         // Place magnifier at cursor ONCE
//         magnifier.style.left = `${clampedX - magnifier.width / 2}px`;
//         magnifier.style.top = `${clampedY - magnifier.height / 2}px`;

//         // Freeze capture point
//         frozenCaptureX = clampedX;
//         frozenCaptureY = clampedY;

//         magnifier.style.display = 'block';
//         magnifierActive = true;
//     }

//     // Always update, but use frozen coords
//     updateMagnifier(magnifier, magnifierCtx, frozenCaptureX, frozenCaptureY);

// } else {
//     if (magnifierActive) {
//         magnifier.style.display = 'none';
//         magnifierActive = false;
//         frozenCaptureX = null;
//         frozenCaptureY = null;
//     }
// }



//         handleInteractions(clampedX, clampedY, cursor);
//     } else {
//         console.log('No face detected');
//     }

//     requestAnimationFrame(() => continueDetection(video, detector, canvas, cursor)); // Call the function again for continuous detection
// }

// Magnifier toggle logic: detect rising edge (mouth opens)
const isCurrentlyOpen = isMouthOpen(keypoints);
    if (isCurrentlyOpen && !wasMouthOpen) {
      if (isZoomed) {
        applyZoom(ZOOM_OUT_LEVEL, clampedX, clampedY);
      } else {
        applyZoom(ZOOM_IN_LEVEL, clampedX, clampedY);
      }
    }
    wasMouthOpen = isCurrentlyOpen;
    handleInteractions(clampedX, clampedY, cursor);
  } else {
    console.log('No face detected');
  }
  requestAnimationFrame(() => continueDetection(video, detector, canvas, cursor));
}



// Euclidean distnace
function calculateDistance(pointA, pointB) {

    return Math.sqrt(Math.pow(pointB.x - pointA.x, 2) + Math.pow(pointB.y - pointA.y, 2));
}



// creating a canvas to draw the detected face landmarks
// to see what the model is detecting important for gaze interactions'
function createCanvas(video) {
    const canvas = document.createElement('canvas');

    // Wait until video is ready to get correct resolution
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Match the video placement, but DO NOT scale canvas
    canvas.style.position = 'fixed';
    canvas.style.top = video.style.top;
    canvas.style.left = video.style.left;
    canvas.style.zIndex = '1001';
    canvas.style.pointerEvents = 'none';
    canvas.style.width = video.style.width;
    canvas.style.height = video.style.height;


    document.body.appendChild(canvas);
    return canvas;
 /////////// CANVAS NEEDS TO BE MORE ACCRUATE THAN THIS I GUESS BUT ITS ALMOST GOOD/////



}

    function createCursor() {
        const cursor = document.createElement('div');
        cursor.style.position = 'fixed';
        cursor.style.width = '10px';
        cursor.style.height = '10px';
        cursor.style.backgroundColor = 'red';
        cursor.style.borderRadius = '50%';
        cursor.style.pointerEvents = 'none'; // Prevent interaction with the cursor
        cursor.style.zIndex = '1000001'; // Ensure it appears above other content
        document.body.appendChild(cursor);
        
        return cursor;
    }
function downloadCSV(gazeData, calibrationResults, overallAccuracy) { // function to download CSV with gaze data and accuracy results
    if (!gazeData.length && !calibrationResults.length && !overallAccuracy) {  //no data to download
        alert("no data to download");
        return;
    }

    const csvRows = []; // Array to hold CSV rows

    csvRows.push("# Gaze Data");
    if (gazeData.length > 0) {
        const gazeHeaders = Object.keys(gazeData[0]);
        csvRows.push(gazeHeaders.join(','));
        for (const row of gazeData) {
            const values = gazeHeaders.map(h => row[h]);
            csvRows.push(values.join(','));
        }
    } else {
        csvRows.push("No gaze data collected");
    }
 
    csvRows.push(""); // Blank line
    csvRows.push("# Per-Point Accuracy"); // get accuracy per calibration point
    if (calibrationResults.length > 0) {
        const accuracyHeaders = [
            "pointIndex",
            "targetX",
            "targetY",
            "avgPredX",
            "avgPredY",
            "errorX",
            "errorY",
            "euclideanError",
            "errorX_percent",
            "errorY_percent",
            "euclideanError_percent"
        ];
        csvRows.push(accuracyHeaders.join(','));
        for (const row of calibrationResults) {
            const values = [
                row.pointIndex,
                row.targetX.toFixed(2),
                row.targetY.toFixed(2),
                row.avgPredX.toFixed(2),
                row.avgPredY.toFixed(2),
                row.errorX.toFixed(2),
                row.errorY.toFixed(2),
                row.euclideanError.toFixed(2),
                row.errorXPercent.toFixed(2),
                row.errorYPercent.toFixed(2),
                row.euclideanErrorPercent.toFixed(2)
            ];
            csvRows.push(values.join(','));
        }
    } else {
        csvRows.push("No per-point accuracy data");
    }

    
    csvRows.push(""); // Blank line
    csvRows.push("# Overall Accuracy"); // overall accuracy metrics
    if (overallAccuracy) {
        csvRows.push("metric,value");
        csvRows.push(`MAE_X,${overallAccuracy.maeX}`);
        csvRows.push(`MAE_Y,${overallAccuracy.maeY}`);
        csvRows.push(`MAE_Euclidean,${overallAccuracy.maeEuclidean}`);
        csvRows.push(`MAE_X_Percent,${overallAccuracy.maeXPercent}`);
        csvRows.push(`MAE_Y_Percent,${overallAccuracy.maeYPercent}`);
        csvRows.push(`MAE_Euclidean_Percent,${overallAccuracy.maeEuclideanPercent}`);
        csvRows.push(`RMSE_X,${overallAccuracy.rmseX}`);
        csvRows.push(`RMSE_Y,${overallAccuracy.rmseY}`);
        csvRows.push(`RMSE_Euclidean,${overallAccuracy.rmseEuclidean}`);
        csvRows.push(`RMSE_X_Percent,${overallAccuracy.rmseXPercent}`);
        csvRows.push(`RMSE_Y_Percent,${overallAccuracy.rmseYPercent}`);
        csvRows.push(`RMSE_Euclidean_Percent,${overallAccuracy.rmseEuclideanPercent}`);
    } else {
        csvRows.push("No overall accuracy data");
    }

    // Create and download CSV
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' }); // turns all csv roes into a single string separated by new lines // blob is a file in memory
    const url = URL.createObjectURL(blob);//points to the blob in memory (pretend it is a file (data stored but not saved on disk yet))
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gaze_data_with_accuracy.csv'; //set the file name
    a.click(); //simulate a click to trigger the download
    URL.revokeObjectURL(url); // free up memory
}


        // const calibrationPoints = [
        // [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
        // [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
        // [0.1, 0.9], [0.5, 0.9], [0.9, 0.9]
        // ];

        ///// just in case needed:
        const calibrationPoints = [
        [0.02, 0.02], [0.25, 0.02], [0.5, 0.02], [0.75, 0.02], [0.98, 0.02],
        [0.02, 0.25], [0.25, 0.25], [0.5, 0.25], [0.75, 0.25], [0.98, 0.25],
        [0.02, 0.5],  [0.25, 0.5],  [0.5, 0.5],  [0.75, 0.5],  [0.98, 0.5],
        [0.02, 0.75], [0.25, 0.75], [0.5, 0.75], [0.75, 0.75], [0.98, 0.75],
        [0.02, 0.98], [0.25, 0.98], [0.5, 0.98], [0.75, 0.98], [0.98, 0.98]
        ];

let currentPointIndex = 0; // Index of the current calibration point
let dotElement = null; // Element to display the red dot


function showNextCalibrationPoint() { // Function to show the next calibration point
    console.log('Showing point:', currentPointIndex + 1);
    if (dotElement) {
        console.log('removing previous dot');
        document.body.removeChild(dotElement); // If a dot is already displayed, remove it
        dotElement = null;
    }

    if (currentPointIndex >= calibrationPoints.length) {// If all calibration points have been shown, finish calibration
        console.log('Calibration complete');
        const overallAccuracy = computeOverallAccuracy();
        downloadCSV(collectedData, calibrationResults, overallAccuracy); // download CSV with gaze data and accuracy results
        return;
    }

    const [xRatio, yRatio] = calibrationPoints[currentPointIndex];  // takes the next calibration point ratios
    const x = window.innerWidth * xRatio;  // Calculate the x position based on the ratio and window width
    const y = window.innerHeight * yRatio;
    console.log('dot position:', { x, y });
    currentCalibrationTarget = { x, y };//set red dot position to the current calibration target
    isCollecting = false;// stop collecting until the next point is shown
    predictedPositionsBuffer = [];

    dotElement = document.createElement('div');  // Create a new div element for the red dot
    dotElement.style.position = 'fixed';
    dotElement.style.left = `${x - 10}px`;  // subtract 10 to center the dot
    dotElement.style.top = `${y - 10}px`;
    dotElement.style.width = '30px';
    dotElement.style.height = '30px';
    dotElement.style.backgroundColor = 'red';
    dotElement.style.border = '2px solid white';
    dotElement.style.borderRadius = '50%';
    dotElement.style.zIndex = '3000';
    dotElement.style.visibility = 'visible';
    document.body.appendChild(dotElement); // Append the dot to the body

    // Wait 1 second, then collect for 3 seconds
    setTimeout(() => {
        isCollecting = true;
        console.log(`Collecting at point ${currentPointIndex + 1}`); // because index starts at 0
        setTimeout(() => {
            isCollecting = false;
            if (predictedPositionsBuffer.length > 0) {
                let sumX = 0, sumY = 0;
                predictedPositionsBuffer.forEach(pos => {
                    sumX += pos.x;
                    sumY += pos.y;
                });
                const avgPredX = sumX / predictedPositionsBuffer.length;
                const avgPredY = sumY / predictedPositionsBuffer.length;
                const errorX = Math.abs(avgPredX - currentCalibrationTarget.x);
                const errorY = Math.abs(avgPredY - currentCalibrationTarget.y);
                const euclideanError = Math.sqrt(errorX ** 2 + errorY ** 2);
                
                // Calculate percentage errors
                const errorXPercent = (errorX / window.innerWidth) * 100;
                const errorYPercent = (errorY / window.innerHeight) * 100;
                const screenDiagonal = Math.sqrt(window.innerWidth ** 2 + window.innerHeight ** 2);
                const euclideanErrorPercent = (euclideanError / screenDiagonal) * 100;

                calibrationResults.push({
                    pointIndex: currentPointIndex,
                    targetX: currentCalibrationTarget.x,
                    targetY: currentCalibrationTarget.y,
                    avgPredX: avgPredX,
                    avgPredY: avgPredY,
                    errorX: errorX,
                    errorY: errorY,
                    euclideanError: euclideanError,
                    errorXPercent: errorXPercent,
                    errorYPercent: errorYPercent,
                    euclideanErrorPercent: euclideanErrorPercent
                });

                console.log(`Point ${currentPointIndex + 1} Accuracy:`);
                console.log(`- Error X: ${errorX.toFixed(2)}px (${errorXPercent.toFixed(2)}%)`);
                console.log(`- Error Y: ${errorY.toFixed(2)}px (${errorYPercent.toFixed(2)}%)`);
                console.log(`- Euclidean: ${euclideanError.toFixed(2)}px (${euclideanErrorPercent.toFixed(2)}%)`);
            } else {
                console.warn(`No predicted positions collected for point ${currentPointIndex + 1}`);
            }
            currentPointIndex++;
            showNextCalibrationPoint();
        }, 3000);
    }, 1000);
}

// function to compute overall accuracy metrics with percentages
function computeOverallAccuracy() {
    if (calibrationResults.length === 0) {
        console.warn("No calibration results to compute accuracy");
        return null;
    }

    let totalErrorX = 0, totalErrorY = 0, totalEuclidean = 0;
    let totalErrorXPercent = 0, totalErrorYPercent = 0, totalEuclideanPercent = 0;
    let sumSqErrorX = 0, sumSqErrorY = 0, sumSqEuclidean = 0;
    let sumSqErrorXPercent = 0, sumSqErrorYPercent = 0, sumSqEuclideanPercent = 0;

    calibrationResults.forEach(result => {
        // absolute errors
        totalErrorX += result.errorX;
        totalErrorY += result.errorY;
        totalEuclidean += result.euclideanError;
        sumSqErrorX += result.errorX ** 2;
        sumSqErrorY += result.errorY ** 2;
        sumSqEuclidean += result.euclideanError ** 2;
        
        // percentage errors
        totalErrorXPercent += result.errorXPercent;
        totalErrorYPercent += result.errorYPercent;
        totalEuclideanPercent += result.euclideanErrorPercent;
        sumSqErrorXPercent += result.errorXPercent ** 2;
        sumSqErrorYPercent += result.errorYPercent ** 2;
        sumSqEuclideanPercent += result.euclideanErrorPercent ** 2;
    });

    const numPoints = calibrationResults.length;
    
    // mean Absolute Error (MAE)
    const maeX = totalErrorX / numPoints;
    const maeY = totalErrorY / numPoints;
    const maeEuclidean = totalEuclidean / numPoints;
    const maeXPercent = totalErrorXPercent / numPoints;
    const maeYPercent = totalErrorYPercent / numPoints;
    const maeEuclideanPercent = totalEuclideanPercent / numPoints;
    
    // root Mean Square Error (RMSE)
    const rmseX = Math.sqrt(sumSqErrorX / numPoints);
    const rmseY = Math.sqrt(sumSqErrorY / numPoints);
    const rmseEuclidean = Math.sqrt(sumSqEuclidean / numPoints);
    const rmseXPercent = Math.sqrt(sumSqErrorXPercent / numPoints);
    const rmseYPercent = Math.sqrt(sumSqErrorYPercent / numPoints);
    const rmseEuclideanPercent = Math.sqrt(sumSqEuclideanPercent / numPoints);

    console.log("Overall Calibration Accuracy:");
    console.log(`- MAE X: ${maeX.toFixed(2)}px (${maeXPercent.toFixed(2)}%)`);
    console.log(`- MAE Y: ${maeY.toFixed(2)}px (${maeYPercent.toFixed(2)}%)`);
    console.log(`- MAE Euclidean: ${maeEuclidean.toFixed(2)}px (${maeEuclideanPercent.toFixed(2)}%)`);
    console.log(`- RMSE X: ${rmseX.toFixed(2)}px (${rmseXPercent.toFixed(2)}%)`);
    console.log(`- RMSE Y: ${rmseY.toFixed(2)}px (${rmseYPercent.toFixed(2)}%)`);
    console.log(`- RMSE Euclidean: ${rmseEuclidean.toFixed(2)}px (${rmseEuclideanPercent.toFixed(2)}%)`);

    // return metrics for CSV including percentages
    return {
        maeX: maeX.toFixed(2),
        maeY: maeY.toFixed(2),
        maeEuclidean: maeEuclidean.toFixed(2),
        maeXPercent: maeXPercent.toFixed(2),
        maeYPercent: maeYPercent.toFixed(2),
        maeEuclideanPercent: maeEuclideanPercent.toFixed(2),
        rmseX: rmseX.toFixed(2),
        rmseY: rmseY.toFixed(2),
        rmseEuclidean: rmseEuclidean.toFixed(2),
        rmseXPercent: rmseXPercent.toFixed(2),
        rmseYPercent: rmseYPercent.toFixed(2),
        rmseEuclideanPercent: rmseEuclideanPercent.toFixed(2)
    };
}

    // Temporal filter helper --> to be added////////////
    const sliding_window = 700; //sliding window length -> keep all gaze samples from last half second
    const slidingWindows = []; // to store gaze x, gaze y and timestamp

    function temporalFilter(x, y){

        const timestamp = performance.now(); // Get the current timestamp -> perforamance better than date.now
        slidingWindows.push({ x, y, timestamp }); // Add the new sample to the sliding window

        while (slidingWindows.length && timestamp - slidingWindows[0].timestamp > sliding_window) { // Remove samples older than the sliding window length
            slidingWindows.shift(); 
        }

        let sumX = 0, sumY = 0; // Initialize sums for x and y coordinates
        for (const sample of slidingWindows) { // Iterate through the samples in the sliding window
            sumX += sample.x; // Sum the x coordinates
            sumY += sample.y; // Sum the y coordinates
        }
        const count = slidingWindows.length || 1 // Get the number of samples in the sliding window, the 1 is a safe fallback just incase ma7de4 3aref bardo

        // return the moving average as mentioned in the proposal
        return {
            x: sumX / count, 
            y: sumY / count 
        };


    }

    /////////////////////////////////////////////////////




        async function main() {
           
            const video = await camera();
            if (!video) return;
            const canvas = createCanvas(video);
            const detector = await loadmodel();
            if (!detector) return;
            const cursor = createCursor();
            createHeatMapLayer();
            //magnifier = createMagnifier();
            //magnifierCtx = magnifier.getContext('2d');
            continueDetection(video, detector, canvas, cursor);
            // showNextCalibrationPoint();
            //testMagnifier(50, 200);
        }


// document.addEventListener('keydown', async (event) => {
//     if (event.key.toLowerCase() === 'm') {
//         if (!magnifier) {
//             magnifier = createMagnifier();
//             magnifierCtx = magnifier.getContext('2d');
//         }
//         magnifier.style.display = magnifier.style.display === 'none' ? 'block' : 'none';
//     }
// });

main();
