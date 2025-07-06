
webgazer.setGazeListener(function(data, elapsedTime) {
	if (data == null) {
		return;
	}
	var xprediction = data.x; //these x coordinates are relative to the viewport
	var yprediction = data.y; //these y coordinates are relative to the viewport
	console.log(elapsedTime); //elapsed time is based on time since begin was called

	webgazer.showPredictionPoints(true);


const DomElements = document.querySelectorAll("button, input, textarea, a, [role='button'], [role='link'], [role='textbox']") // get all dom elements
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
if (closestElement && closestDistance < 120) { // activate while in range (we can change this later for better accuracy:) )
	const tag = closestElement.tagName.toLowerCase();
     
	if (tag=="button" || closestElement.getAttribute("role")==="button"){
	console.log("button click click")
	closestElement.click();
	}
	else if(tag=="input" || closestElement.getAttribute("role")==="textbox"){
	console.log("I am a textbox")
	closestElement.click();
	}
	else if(tag=="a" || closestElement.getAttribute("role")==="link"){
	console.log("I am a link")
	closestElement.click();
	}

	    
}
}).begin();