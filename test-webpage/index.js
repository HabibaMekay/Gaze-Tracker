let smoothedX = 0, smoothedY = 0;// store the last smoothed gaze position
const SMOOTHING = 0.2;  ///make this bigger to move the dot more quickly (lighter gaze movements)//// smaller to make it more stable and slow
let baselineVy = null;
const GAZE_SENSITIVITY_X = 5;  // Horizontal sensitivity
const GAZE_SENSITIVITY_Y = 40; // Higher vertical sensitivity
let baselineFrameCount = 0; // Count frames for baseline adjustment
const BASELINE_MAX_FRAMES = 30; // Maximum frames to adjust baseline
const BASELINE_UPDATE_THRESHOLD = 0.005;//ignore head movements that are too large to avoid adjusting the baseline too frequently
let baselineVx = null;
let minVx =  Infinity, maxVx = -Infinity;
let minVy =  Infinity, maxVy = -Infinity;
const collectedData = []; // This is where we will save gaze data
let currentCalibrationTarget = null; // Current red dot position
let isCollecting = false; // Whether we are currently collecting data

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
        // Play the video
        await video.play();
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

// Start detecting the face in the video stream
//  canvas is implmented after this function dont be confused :)
async function continueDetection(video, detector,canvas,cursor) {
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
            requestAnimationFrame(() => continueDetection(video, detector, canvas, cursor)); // Skip the frame if iris shape is not valid
            return;
        }

// Iris centers: tells where the pupil is pionting
        const rightEyeIris = keypoints[477]; // Right eye iris center
        const leftEyeIris = keypoints[472]; // Left eye iris center

        if (isCollecting && currentCalibrationTarget) { // If we are collecting data and have a calibration target(red dot)
        const timestamp = Date.now(); // Get the current timestamp

        const videoWidth = video.videoWidth; // Get the video width to normalize coordinates to 
        const videoHeight = video.videoHeight; // Get the video height

        const sample = { // Create a sample object with the collected data
            timestamp,
            left_iris_x: (leftEyeIris.x / videoWidth).toFixed(5),// Normalize iris coordinates by video dimensions
            left_iris_y: (leftEyeIris.y / videoHeight).toFixed(5), //scalled to 0-1 range so it works on any screen size
            right_iris_x: (rightEyeIris.x / videoWidth).toFixed(5),
            right_iris_y: (rightEyeIris.y / videoHeight).toFixed(5),
            gaze_x: currentCalibrationTarget.x.toFixed(0), // where the red dot is located
            gaze_y: currentCalibrationTarget.y.toFixed(0) 
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
        }); ctx.restore();

        // Pc =Pl_corner + Pr_corner
        // Pl_corner and pr_corner stand for the located left eye inner corner and right eye inner corner
        const conrnerCenter ={
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
            x: irisCenter.x - conrnerCenter.x,      
            y: irisCenter.y - conrnerCenter.y
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
        const centeredVx = Vx - baselineVx;
        const centeredVy =   Vy- baselineVy ; // subtract baslineVy so look straight is 0 
        const normalizedGazeVector = {                                      
                x: -centeredVx,  
                y:  - centeredVy // Invert x to match screen coordinates, y is inverted to match the screen coordinate system
         }; 
         
         console.log('Centered Vy (Vy - baselineVy):', centeredVy.toFixed(3));


         console.log('Normalized Gaze Vector:', normalizedGazeVector);
        
        const MAX_PIXELS_X = window.innerWidth; // set the maximum pixels to the window width
        const MAX_PIXELS_Y = window.innerHeight; // set the maximum pixels to the window height
        console.log('Vx:', Vx.toFixed(3), 'Vy:', Vy.toFixed(3));
     
        
      
        smoothedX = smoothedX * (1 - SMOOTHING) + normalizedGazeVector.x * SMOOTHING; //makes the dot glide smoothly using old and new values

        smoothedY =  smoothedY * (1 - SMOOTHING) + normalizedGazeVector.y * SMOOTHING; //1- smoothing means how much of the old value we want to keep, 0.1 means we keep 10% of the old value and 90% of the new value

       
       // Here we start to convert gaze to scren movemnet 
       function softSigmoid(v, gain ){ // Soft sigmoid function to map gaze values to screen movement // higher gain means less sensitivity, lower gain means more sensitivity
        // maps -1…+1 to ~-1…+1 but flattens near 0 
        return v / (1 + Math.abs(v)*gain);
      }

      const dx = softSigmoid(smoothedX ,0.1) * window.innerWidth  * GAZE_SENSITIVITY_X;
      const dy = softSigmoid(smoothedY,0.3) * window.innerHeight * GAZE_SENSITIVITY_Y * -1; // Invert dy to match screen coordinates, where down is positive
        
        console.log('SmoothedX:', smoothedX.toFixed(3), 'SmoothedY:', smoothedY.toFixed(3));

      
        const centerX = window.innerWidth  / 2; // center of the screen
        const centerY = window.innerHeight / 2;

        const rawX = centerX + dx - cursor.offsetWidth / 2; // takes the center of the screen and adds the gaze movement, then centers the cursor because the cursor is positioned at the top left corner
        const rawY = centerY + dy - cursor.offsetHeight / 2;

        const maxX = window.innerWidth - cursor.offsetWidth / 2; //sunbtract half the cursor width so, the dot’s center is placed at the eye's target, not its corner
        const maxY = window.innerHeight - cursor.offsetHeight / 2;

        const minX = 0 - cursor.offsetWidth / 2;// to make sure the cursor does not go off screen
        const minY = 0 - cursor.offsetHeight / 2;

        const clampedX = Math.min(Math.max(rawX, minX), maxX);// clamps the x coordinate to be within the screen bounds
        const clampedY = Math.min(Math.max(rawY, minY), maxY); // if too high or too low, it will be set to the max or min value

        cursor.style.left = `${clampedX}px`; //takes the clamped x and y coordinates and sets the cursor position
        cursor.style.top  = `${clampedY}px`;
        

        console.log('dx (pixels):', dx.toFixed(1), 'dy (pixels):', dy.toFixed(1));
        console.log('Cursor screen position:', { x: clampedX.toFixed(1), y: clampedY.toFixed(1) });



      heatCtx.beginPath();
      heatCtx.arc(clampedX + 5, clampedY + 5, 3, 0, 2 * Math.PI);
      heatCtx.fillStyle = 'rgba(255, 0, 0, 0.1)';   
      heatCtx.fill();
      

    } else {
        console.log('No face detected');
    }
    requestAnimationFrame(() => continueDetection(video, detector,canvas,cursor)); // Call the function again for continuous detection
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


        const calibrationPoints = [ // 3x3 grid of calibration points
        [0.2, 0.2], [0.5, 0.2], [0.8, 0.2],
        [0.2, 0.5], [0.5, 0.5], [0.8, 0.5],
        [0.2, 0.8], [0.5, 0.8], [0.8, 0.8]
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






        async function main() {
            const video = await camera();
            if (!video) return;

            const canvas = createCanvas(video); 

            const detector = await loadmodel(); 
            if (!detector) return;
            const cursor = createCursor();
            createHeatMapLayer();
            continueDetection(video, detector, canvas,cursor); 
            showNextCalibrationPoint();

        
        }




main();