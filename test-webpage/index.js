let smoothedX = 0, smoothedY = 0;// store the last smoothed gaze position
const SMOOTHING = 0.2;  ///make this bigger to move the dot more quickly (lighter gaze movements)//// smaller to make it more stable and slow
let baselineVy = null;
const GAZE_SENSITIVITY_X = 5;  // Horizontal sensitivity
const GAZE_SENSITIVITY_Y = 40; // Higher vertical sensitivity
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
        console.log('Face detected:', face[0]);

        const keypoints = face[0].keypoints; // Get the keypoints of the detected face
// The model returns 478 (Keypoints) facial landmarks :
// - Left eye iris landmarks: indices 468 to 472 (5 points)
// - Right eye iris landmarks: indices 473 to 477 (5 points)
// we are using them to estimate iris center or gaze direction


// Iris centers: tells where the pupil is pionting
        const rightEyeIris = keypoints[477]; // Right eye iris center
        const leftEyeIris = keypoints[472]; // Left eye iris center

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

        const H = calculateDistance(noseBridge, nosetip); // Calculate the height of the nose bridge
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
        if (baselineVy === null) { // set baselineVy on first frame "Vy",so head tilts "Vx" don’t confuse the cursor
            // capture first stable frame as looking straight
        baselineVy = Vy;
        console.log('Baseline Vy set to:', baselineVy.toFixed(3));
        }
         
          /// screen's Y axis is 0 at the top and increases downwards ////// look down Vy-> increases and vice versa
        const centeredVy =   Vy- baselineVy ; // subtract baslineVy so look straight is 0 
        const normalizedGazeVector = {                                      
                x: -Vx,  
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

        const dx = smoothedX * MAX_PIXELS_X * GAZE_SENSITIVITY_X; //turns the normalized gaze vector into pixel movement
        // flip the y direction to match the screen coordinate system not like x
        const dy = -smoothedY * MAX_PIXELS_Y * GAZE_SENSITIVITY_Y;
        
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







async function main() {
    const video = await camera();
    if (!video) return;

    const canvas = createCanvas(video); 

    const detector = await loadmodel(); 
    if (!detector) return;
    const cursor = createCursor();
    continueDetection(video, detector, canvas,cursor); 

  
}




main();