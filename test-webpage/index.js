let smoothedX = 0, smoothedY = 0;// store the last smoothed gaze position
const SMOOTHING = 0.1;  ///make this bigger to move the dot more quickly (lighter gaze movements)//// smaller to make it more stable and slow
let baselineVy = null;
const GAZE_SENSITIVITY_X = 0.5;  // Horizontal sensitivity
const GAZE_SENSITIVITY_Y = 1; // Higher vertical sensitivity
const AMPLIFY_RIGHT = 13, AMPLIFY_LEFT = 35; // reversed
const AMPLIFY_UP = 74, AMPLIFY_DOWN = 55;
let baselineFrameCount = 0; // Count frames for baseline adjustment
const BASELINE_MAX_FRAMES = 30; // Maximum frames to adjust baseline
const BASELINE_UPDATE_THRESHOLD = 0.005;//ignore head movements that are too large to avoid adjusting the baseline too frequently
let baselineVx = null;
let minVx =  Infinity, maxVx = -Infinity;
let minVy =  Infinity, maxVy = -Infinity;
const collectedData = []; // This is where we will save gaze data
let currentCalibrationTarget = null; // Current red dot position
let isCollecting = false; // Whether we are currently collecting data
let taskCompletions = 0;
let errors = 0;
let magnifier = null;
let magnifierCtx = null;


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
const dwellThreshold = 1000; // Dwell time threshold in milliseconds (1 second)

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
        else if (element.classList.contains('virtual-key')) typeScore = 1.1;
        else typeScore = 0.5;

        const totalScore = distanceScore * typeScore * sizeFactor;

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
function createMagnifier() {
    const magnifier = document.createElement('canvas');
    magnifier.width = 200;
    magnifier.height = 200;
    magnifier.style.position = 'fixed';
    magnifier.style.border = '2px solid #000';
    magnifier.style.borderRadius = '50%';
    magnifier.style.zIndex = '2500';
    magnifier.style.pointerEvents = 'none';
    magnifier.style.display = 'none';
    magnifier.style.backgroundColor = 'white'; 
    document.body.appendChild(magnifier);
    return magnifier;
}

function showVirtualKeyboard(targetInput) {
    let existingKeyboard = document.getElementById('virtual-keyboard');
    if (existingKeyboard) existingKeyboard.remove();

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

    const rows = [
        ['1','2','3','4','5','6','7','8','9','0','←'],
        ['Q','W','E','R','T','Y','U','I','O','P'],
        ['A','S','D','F','G','H','J','K','L'],
        ['Z','X','C','V','B','N','M'],
        ['Space']
    ];

    rows.forEach(row => {
        const rowDiv = document.createElement('div');
        rowDiv.style.display = 'flex';
        rowDiv.style.justifyContent = 'center';
        rowDiv.style.marginBottom = '5px';

        row.forEach(key => {
            const btn = document.createElement('button');
            btn.textContent = key === 'Space' ? '____' : key;
			btn.classList.add("virtual-key");
            btn.style.padding = key === 'Space' ? '10px 80px' : '10px 14px';
            btn.style.margin = '3px';
            btn.style.fontSize = '16px';
            btn.style.cursor = 'pointer';
            btn.style.border = '1px solid #888';
            btn.style.borderRadius = '6px';
            btn.style.background = '#f2f2f2';

            btn.addEventListener('click', () => {
                if (key === '←') {
                    targetInput.value = targetInput.value.slice(0, -1);
                } else if (key === 'Space') {
                    targetInput.value += ' ';
                } else {
                    targetInput.value += key;
                }
                targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            });

            rowDiv.appendChild(btn);
        });

        keyboard.appendChild(rowDiv);
    });

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
async function continueDetection(video, detector, canvas, cursor, gazeModel) {
    const face = await detector.estimateFaces(video);
    const ctx = canvas.getContext('2d');
    //////////////////// FOR THE MODEL ///////////////////////
    let modelDx = 0;
    let modelDy = 0;
    /////////////////////////////////////////////////////////

    ctx.clearRect(0, 0, canvas.width, canvas.height); // Clear the canvas before drawing    

    if (face.length > 0) {
        if (face[0].faceInViewConfidence !== undefined && face[0].faceInViewConfidence < 0.99) {
            console.warn("Low confidence — skipping frame"); // if confidence is low, skip the frame // maybe add a warning or make users refresh the page
            requestAnimationFrame(() => continueDetection(video, detector, canvas, cursor,gazeModel));
            return;
        }
        console.log('Face detected:', face[0]);

        const keypoints = face[0].keypoints; // Get the keypoints of the detected face
// The model returns 478 (Keypoints) facial landmarks :
// - Left eye iris landmarks: indices 468 to 472 (5 points)
// - Right eye iris landmarks: indices 473 to 477 (5 points)
// we are using them to estimate iris center or gaze direction
         const rightIrisPoints = [keypoints[473], keypoints[474], keypoints[475], keypoints[476], keypoints[477]];// Right eye iris landmarks
        const leftIrisPoints  = [keypoints[468], keypoints[469], keypoints[470], keypoints[471], keypoints[472]];// Left eye iris landmarks

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

        if (!isIrisShapeValid(rightIrisPoints) || !isIrisShapeValid(leftIrisPoints)) { //if eye is not circleish skip the frame
            console.warn("Iris shape invalid — skipping frame");
            requestAnimationFrame(() => continueDetection(video, detector, canvas, cursor,gazeModel)); // Skip the frame if iris shape is not valid
            return;
        }

// Iris centers: tells where the pupil is pionting
        const rightEyeIris = keypoints[477]; // Right eye iris center
        const leftEyeIris = keypoints[472]; // Left eye iris center

        if (isCollecting && currentCalibrationTarget) { // If we are collecting data and have a calibration target(red dot)
        const timestamp = Date.now(); // Get the current timestamp

        const videoWidth = video.videoWidth; // Get the video width to normalize coordinates to 
        const videoHeight = video.videoHeight; // Get the video height

        ////////////////////FOR THE MODEL/////////////////////

        const inputTensor = tf.tensor2d([[
        leftEyeIris.x / videoWidth,
        leftEyeIris.y / videoHeight,
        rightEyeIris.x / videoWidth,
        rightEyeIris.y / videoHeight
        ]]);


        const prediction = gazeModel.predict(inputTensor);
        const [predX, predY] = prediction.dataSync(); // These are in 0–1 normalized screen coordinates
        inputTensor.dispose();
        prediction.dispose();

        modelDx = predX * window.innerWidth;
        modelDy = predY * window.innerHeight;


        //////////////////////////////////////////////////////
        //////////////////////////////////////////////////////

        const sample = {
            timestamp,
            left_iris_x: (leftEyeIris.x / videoWidth).toFixed(5),
            left_iris_y: (leftEyeIris.y / videoHeight).toFixed(5),
            right_iris_x: (rightEyeIris.x / videoWidth).toFixed(5),
            right_iris_y: (rightEyeIris.y / videoHeight).toFixed(5),
            gaze_x: currentCalibrationTarget.x.toFixed(0),
            gaze_y: currentCalibrationTarget.y.toFixed(0),
            screen_width: window.innerWidth,   // <--- add this
            screen_height: window.innerHeight  // <--- add this
        };


        collectedData.push(sample); // Add the sample to the collected data array
        }


 // where eye is located, to measure if the eye is looking inward or outward aka left or right
        const leftEyeInnerCorner = keypoints[133]; 
        const leftEyeOuterCorner = keypoints[33];

        const rightEyeInnerCorner = keypoints[362]; 
        const rightEyeOuterCorner = keypoints[263];


        // Mirror drawing to match video
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);

        [leftEyeIris, rightEyeIris].forEach(iris => {
           ctx.beginPath();
           ctx.arc(iris.x, iris.y, 5,  0, 2 * Math.PI); // draw a circle around the iris center
           ctx.fillStyle = 'red'; 
           ctx.fill();
           ctx.closePath();
        }); 
        ctx.restore();

        // Pc =Pl_corner + Pr_corner
        // Pl_corner and pr_corner stand for the located left eye inner corner and right eye inner corner
        const cornerCenter ={
            x:(leftEyeInnerCorner.x + rightEyeInnerCorner.x )/2,
            y:(leftEyeInnerCorner.y + rightEyeInnerCorner.y )/2
        }

        //PI = Pl_iris + Pr_iris
        // Pl_iris and Pr_iris stand for the located left and right iris centers, respectively
        const irisCenter = {
            x: (leftEyeIris.x + rightEyeIris.x) / 2,
            y: (leftEyeIris.y + rightEyeIris.y) / 2
        };

        //Vg = PI -Pc
        // Vg is the gaze vector, which is the vector from the center of the eyes
        const gazeVector = {
            x: irisCenter.x - cornerCenter.x,      
            y: irisCenter.y - cornerCenter.y
        };

        // here we are going to normalize to remove scale dependency (gaze estimation will be independent of face size and zoom)
        // also to handle head movements, to make sure features are usable for mapping to screen coordinates
        //analogy: to know where someone is pionting according to thier hieght, a child vs an adult can piont in the same direction but at different heights
        
        // Vx = Vg.x /L -> L is the distnace between eye corners
        const L = calculateDistance(leftEyeInnerCorner, rightEyeInnerCorner); 
        const Vx = gazeVector.x / L; // Normalize the x component of the gaze vector

        // Vy = Vg.y /H -> H is the nose bridge height
        const noseBridge= keypoints[168];
        const nosetip = keypoints[2];

        // For the head frame//////////////////////////////////////////////
        const isInsideHeadFrame = drawCircleFrame(
        ctx,
        nosetip,
        leftEyeInnerCorner,
        rightEyeInnerCorner,
        canvas
        );
                if (!isInsideHeadFrame) { // If the nose tip is outside the head frame, skip the frame
                    console.warn("Nose tip outside head frame — skipping frame");   
                    requestAnimationFrame(() => continueDetection(video, detector, canvas, cursor,gazeModel));
                    return;} // Skip the frame if the nose tip is outside the head frame
        // End of head frame////////////////////////////////////////////////

        const H = Math.max(0.001, calculateDistance(noseBridge, nosetip)); // Calculate the height of the nose bridge//how close the head is to the camera, to avoid division by zero
        const Vy = gazeVector.y / H; // Normalize the y component of the gaze vector

       // Debugiing////////////////////////////////////////////////////
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
    /////////////////////////////////////////////////////////////////////

      // THE FINAL NORMALIZED GAZE VECTOR///////////////
    if (baselineFrameCount < BASELINE_MAX_FRAMES) {        // first 30 frames are used to calculate the baseline
      // This is to avoid adjusting the baseline too frequently, which can lead to instability

      // vertical baseline //
      if (baselineVy === null) baselineVy = Vy;          
      const deltaVy = Math.abs(Vy - baselineVy);
      if (deltaVy < BASELINE_UPDATE_THRESHOLD) {
        baselineVy = 0.9 * baselineVy + 0.1 * Vy;          
      }

      // horizontl baseline //
      if (baselineVx === null) baselineVx = Vx;
      const deltaVx = Math.abs(Vx - baselineVx);
      if (deltaVx < BASELINE_UPDATE_THRESHOLD) {
        baselineVx = 0.9 * baselineVx + 0.1 * Vx;
      }

      baselineFrameCount++;                                //  increment once per frame
    } 

          /// screen's Y axis is 0 at the top and increases downwards ////// look down Vy-> increases and vice versa
          // const centeredVx = Vx - baselineVx;
        // const centeredVy =   Vy- baselineVy ; // subtract baslineVy so look straight is 0 
        // const normalizedGazeVector = {                                      
        //         x: -centeredVx,  
        //         y:  - centeredVy // Invert x becuase the video is mirrored, y is inverted to match the screen coordinate system
        //  }; 
        const centeredVx = (Vx - baselineVx) ;
        const centeredVy = (Vy - baselineVy) ;

        const amplifiedVx = centeredVx < 0 ? centeredVx * AMPLIFY_LEFT : centeredVx * AMPLIFY_RIGHT;
        const amplifiedVy = centeredVy < 0 ? centeredVy * AMPLIFY_UP : centeredVy * AMPLIFY_DOWN;

        const normalizedGazeVector = {
        x: -amplifiedVx,
        y: -amplifiedVy 
        };
        console.log('Centered Vy (Vy - baselineVy):', centeredVy.toFixed(3));


         console.log('Normalized Gaze Vector:', normalizedGazeVector);
        
        const MAX_PIXELS_X = window.innerWidth; // set the maximum pixels to the window width
        const MAX_PIXELS_Y = window.innerHeight; // set the maximum pixels to the window height
        console.log('Vx:', Vx.toFixed(3), 'Vy:', Vy.toFixed(3));
     
        

        // smoothedX = smoothedX * (1 - SMOOTHING) + normalizedGazeVector.x * SMOOTHING; //makes the dot glide smoothly using old and new values

        // smoothedY =  smoothedY * (1 - SMOOTHING) + normalizedGazeVector.y * SMOOTHING; //1- smoothing means how much of the old value we want to keep, 0.1 means we keep 10% of the old value and 90% of the new value
        



       ////////////////////////////////////////////////////////////////////////////
       // Here we start to convert gaze to scren movemnet 
       function softSigmoid(v, gain ){ // Soft sigmoid function to map gaze values to screen movement // higher gain means less sensitivity, lower gain means more sensitivity
        // maps -1…+1 to ~-1…+1 but flattens near 0 
        return v / (1 + Math.abs(v)*gain);
      }

    //   const dx = softSigmoid(smoothedX ,0.1) * window.innerWidth  * GAZE_SENSITIVITY_X;
    //   const dy = softSigmoid(smoothedY,0.1) * window.innerHeight * GAZE_SENSITIVITY_Y * -1; // Invert dy to match screen coordinates, where down is positive
       
    //   const dx = smoothedX * window.innerWidth  * GAZE_SENSITIVITY_X;
    //   const dy = smoothedY * window.innerHeight * GAZE_SENSITIVITY_Y * -1; // Invert dy to match screen coordinates, where down is positive

        
        /// UNCOMMENT WHEN READY TO BE INTEGRATED///////////
        //////////////////// FOR THE TEMPORAL FILTERING//////////////////////
        //REMOVE THE PREVOIUS 4 SMOOTHED LINES AS THE FOLLOWING  IS THE INTEGRATION OF THEM WITH THE SLIDING WINDOWS
        const temporallySmoothed = temporalFilter(normalizedGazeVector.x, normalizedGazeVector.y);
        const smoothedX = temporallySmoothed.x;
        const smoothedY = temporallySmoothed.y;
        const dx = smoothedX * window.innerWidth * GAZE_SENSITIVITY_X;
        const dy = smoothedY * window.innerHeight * GAZE_SENSITIVITY_Y * -1;
        
      ///////////////////////FRO THE MODEL/////////////////////
        const FUSION_WEIGHT = 0.5; // tune between 0 (ML only) to 1 (vector only)
        const fusedDx = FUSION_WEIGHT * dx + (1 - FUSION_WEIGHT) * modelDx;
        const fusedDy = FUSION_WEIGHT * dy + (1 - FUSION_WEIGHT) * modelDy;
      ////////////////////////////////////////////////////////

        console.log('SmoothedX:', smoothedX.toFixed(3), 'SmoothedY:', smoothedY.toFixed(3));

        const centerX = window.innerWidth / 2; // center of the screen
        const centerY = window.innerHeight / 2;
        //////////////////////// FOR THE MODEL ///////////////////////
        // const rawX = centerX + dx - cursor.offsetWidth / 2; // takes the center of the screen and adds the gaze movement, then centers the cursor because the cursor is positioned at the top left corner
        // const rawY = centerY + dy - cursor.offsetHeight / 2;
        const rawX = centerX + fusedDx - cursor.offsetWidth / 2;
        const rawY = centerY + fusedDy - cursor.offsetHeight / 2;
///////////////////////////////////////////////////////////////////////////////
        const maxX = window.innerWidth - cursor.offsetWidth / 2; //sunbtract half the cursor width so, the dot’s center is placed at the eye's target, not its corner
        const maxY = window.innerHeight - cursor.offsetHeight / 2;
        const minX = 0 - cursor.offsetWidth / 2;// to make sure the cursor does not go off screen
        const minY = 0 - cursor.offsetHeight / 2;
        const clampedX = Math.min(Math.max(rawX, minX), maxX);// clamps the x coordinate to be within the screen bounds
        const clampedY = Math.min(Math.max(rawY, minY), maxY); // if too high or too low, it will be set to the max or min value
        cursor.style.left = `${clampedX}px`; //takes the clamped x and y coordinates and sets the cursor position
        cursor.style.top = `${clampedY}px`;
        
        console.log('dx (pixels):', dx.toFixed(1), 'dy (pixels):', dy.toFixed(1));
        console.log('Cursor screen position:', { x: clampedX.toFixed(1), y: clampedY.toFixed(1) });

// if (magnifier && magnifierCtx) {
//     try {
//         const zoomFactor = 2;
//         const captureSize = 100; // Area to capture (will be zoomed 2x)
        
//         // Get cursor center position
//         const cursorCenterX = clampedX + cursor.offsetWidth / 2;
//         const cursorCenterY = clampedY + cursor.offsetHeight / 2;
        
//         // Position magnifier near cursor
//         magnifier.style.left = `${cursorCenterX + 20}px`;
//         magnifier.style.top = `${cursorCenterY - magnifier.height - 20}px`;
        
//         // Create temporary canvas for capture
//         const tempCanvas = document.createElement('canvas');
//         tempCanvas.width = captureSize;
//         tempCanvas.height = captureSize;
//         const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        
//         // Fill with white background first
//         tempCtx.fillStyle = 'white';
//         tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
//         // Capture screen area - we need to use html2canvas for proper capturing
//         await new Promise(resolve => {
//             html2canvas(document.body, {
//                 x: cursorCenterX - captureSize/2,
//                 y: cursorCenterY - captureSize/2,
//                 width: captureSize,
//                 height: captureSize,
//                 scale: 1,
//                 logging: false,
//                 useCORS: true,
//                 onclone: (clonedDoc) => {
//                     // Hide the magnifier in the clone to avoid recursion
//                     const clonedMagnifier = clonedDoc.querySelector('canvas[style*="fixed"]');
//                     if (clonedMagnifier) clonedMagnifier.style.display = 'none';
//                 }
//             }).then(canvas => {
//                 tempCtx.drawImage(canvas, 0, 0, captureSize, captureSize);
//                 resolve();
//             });
//         });
        
//         // Draw to magnifier
//         magnifierCtx.clearRect(0, 0, magnifier.width, magnifier.height);
//         magnifierCtx.drawImage(
//             tempCanvas,
//             0, 0, captureSize, captureSize,
//             0, 0, magnifier.width, magnifier.height
//         );
        
//         // Add crosshair
//         magnifierCtx.strokeStyle = 'red';
//         magnifierCtx.lineWidth = 2;
//         magnifierCtx.beginPath();
//         magnifierCtx.moveTo(magnifier.width/2, 0);
//         magnifierCtx.lineTo(magnifier.width/2, magnifier.height);
//         magnifierCtx.moveTo(0, magnifier.height/2);
//         magnifierCtx.lineTo(magnifier.width, magnifier.height/2);
//         magnifierCtx.stroke();
        
//     } catch (e) {
//         console.warn("Magnifier error:", e);
//     }
// }
        heatCtx.beginPath();
        heatCtx.arc(clampedX + 5, clampedY + 5, 3, 0, 2 * Math.PI);
        heatCtx.fillStyle = 'rgba(255, 0, 0, 0.1)';   
        heatCtx.fill();
      
        if (!isCollecting) { // Only interact when not calibrating
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
                    if (dwellTime >= dwellThreshold) {
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
                        } else if (closestElement.classList.contains('virtual-key')) {
                            console.log("Virtual key clicked via gaze");
                            closestElement.click();
                        }
                        dwellStartTime = null;
                        activeElement = null;
                    }
                } else {
                    activeElement = closestElement;
                    dwellStartTime = Date.now();
                }
            } else {
                if (closestDistance > 120) errors++;
                dwellStartTime = null;
                activeElement = null;
            }
        }
    } else {
        console.log('No face detected');
    }
    requestAnimationFrame(() => continueDetection(video, detector, canvas, cursor, gazeModel));  // Call the function again for continuous detection
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
        cursor.style.zIndex = '2000'; // Ensure it appears above other content
        document.body.appendChild(cursor);
        return cursor;
    }

    function downloadCSV(data) { // Function to download collected gaze data as a CSV file to train on it later
        if (data.length === 0) { 
            alert("No data to download");
            return;
        }

        const csvRows = []; // Array to hold CSV rows
        const headers = Object.keys(data[0]); // Get the headers from the first data object
        csvRows.push(headers.join(',')); // Add headers to the first row

        for (const row of data) {   // Iterate through each data object and create a CSV row
            const values = headers.map(h => row[h]); // Get values for each header
            csvRows.push(values.join(',')); // Join values with commas, and add the string as a new row
        }

        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' }); // turns all csv roes into a single string separated by new lines // blob is a file in memory
        const url = URL.createObjectURL(blob); //points to the blob in memory (pretend it is a file (data stored but not saved on disk yet))
        const a = document.createElement('a');
        a.href = url;
        a.download = 'gaze_data.csv'; // Set the file name for download
        a.click(); // simmulate a click to trigger the download
        URL.revokeObjectURL(url); // Clean up the temp URL object to free memory
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
        if (dotElement) { // If a dot is already displayed, remove it
            document.body.removeChild(dotElement);
            dotElement = null; // clear the old dot before showing the next one
        }

        if (currentPointIndex >= calibrationPoints.length) { // If all calibration points have been shown, finish calibration
            console.log(" Calibration complete");
            downloadCSV(collectedData); // call the download csv function to save the collected data
            return;
        }

        const [xRatio, yRatio] = calibrationPoints[currentPointIndex]; // takes the next calibration point ratios
        const x = window.innerWidth * xRatio; // Calculate the x position based on the ratio and window width
        const y = window.innerHeight * yRatio;

        console.log(window.innerWidth+ "   eww  "+ window.innerHeight);

        currentCalibrationTarget = { x, y }; //set red dot position to the current calibration target
        isCollecting = false; // stop collecting until the next point is shown

        dotElement = document.createElement('div'); // Create a new div element for the red dot
        dotElement.style.position = 'fixed';
        dotElement.style.left = `${x - 10}px`;
        dotElement.style.top = `${y - 10}px`; // subtract 10 to center the dot
        dotElement.style.width = '20px';
        dotElement.style.height = '20px';
        dotElement.style.backgroundColor = 'black';
        dotElement.style.borderRadius = '50%';
        dotElement.style.zIndex = 3000;
        document.body.appendChild(dotElement); // Append the dot to the body

        // Wait 1 second, then collect for 3 seconds
        setTimeout(() => {
            isCollecting = true; 
            console.log(` Collecting at point ${currentPointIndex + 1}`); // because index starts at 0
            setTimeout(() => {
            isCollecting = false;
            currentPointIndex++; // move to the next point
            showNextCalibrationPoint(); //show next point 
            }, 3000); // Collect data for 3 seconds at this point
        }, 1000); // Wait 1 second before starting to collect data
        }

    // Temporal filter helper --> to be added////////////
    const sliding_window = 500; //sliding window length -> keep all gaze samples from last half second
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
            const gazeModel = await tf.loadLayersModel('model/model.json');
            const video = await camera();
            if (!video) return;
            const canvas = createCanvas(video);
            const detector = await loadmodel();
            if (!detector) return;
            const cursor = createCursor();
            createHeatMapLayer();
            // magnifier = createMagnifier();
            // magnifierCtx = magnifier.getContext('2d');
            continueDetection(video, detector, canvas, cursor, gazeModel);
            showNextCalibrationPoint();
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