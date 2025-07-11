let dwellStartTime = null;
let dwellThreshold = 1000;
activeElement = null;

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

// start tracking gaze
webgazer
  .setTracker("TFFacemesh") //set a tracker module
  .setRegression('weightedRidge')
  .showPredictionPoints(true) 
  .begin();


console.log("Tracker in use:", webgazer.getTracker());
console.log("All available trackers:", webgazer.trackerModules);


// Stabilize predictions
webgazer.params.smoothing = 0.95; // Reduce jitter

// respond to gaze data
webgazer.setGazeListener(function(data, elapsedTime) {
	if (data == null) {
		dwellStartTime = null;
		activeElement = null;
		return;
	}
	var xprediction = data.x; //these x coordinates are relative to the viewport
	var yprediction = data.y; //these y coordinates are relative to the viewport
	console.log(elapsedTime); //elapsed time is based on time since begin was called




const DomElements = document.querySelectorAll("button, input, textarea, a, .virtual-key, [role='button'], [role='link'], [role='textbox']") // get all dom elements
let closestElement =null; // no closest element yet
let closestDistance =Infinity; // initialize to a very large value

for(let i=0;i< DomElements.length;i++) // loop on all dom elements
{
    const element =DomElements[i]; //  current element
	const rect = element.getBoundingClientRect(); //  get size and position info
    const centerX = rect.left + rect.width / 2; //center x coordinate
    const centerY = rect.top + rect.height / 2; // center y coordinate
	const distance = Math.sqrt((centerX - xprediction)**2 + (centerY - yprediction)**2); // distance from gaze to element center
	  if (distance < closestDistance) { //  if this element is closer 
            closestDistance = distance;
            closestElement = element; // take it as the closest
        }
}



if (closestElement && closestDistance < 120) { //this number must be changed later
	    const tag = closestElement.tagName.toLowerCase();

        if (activeElement === closestElement) {
            const dwellTime = Date.now() - dwellStartTime;
			console.log(`Dwell progress: ${dwellTime}`);
            if (dwellTime >= dwellThreshold) {
				console.log(`Dwell progress REAHCED`);
                	if (tag=="button" || closestElement.getAttribute("role")==="button"){
					console.log("button click click")
					closestElement.click();
					}
					else if (tag == "input" || tag == "textarea" || closestElement.getAttribute("role") === "textbox") {
					console.log("I am a textbox");
					closestElement.click();
					showVirtualKeyboard(closestElement); 
					}
					else if(tag=="a" || closestElement.getAttribute("role")==="link"){
					console.log("I am a link")
					closestElement.click();
					}
					else if (closestElement.classList.contains('virtual-key')) {
					console.log("Gaze clicked virtual key");
					closestElement.click();
					}
                dwellStartTime = null; // da reset after click
                activeElement = null;
            }
        } else {
            
            activeElement = closestElement;
            dwellStartTime = Date.now();
        }
    } else {
        dwellStartTime = null;
        activeElement = null;
    }
});
