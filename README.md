## Context-Aware Gaze-Based Interaction for Users with Motor Disabilities

> This is a research prototype for a low-cost and calibration-free gaze-based system focusing on accessibility for people with motor disabilities

---
## Table of Contents

- [Features](#features)
- [Built With](#tech-stack)
- [Datasets](#Datasets)
- [Evaluation Criteria](#evaluation-criteria)
- [Installation](#installation)
- [Usage](#usage)
- [License](#license)

---

## Features
- Real-time gaze tracking using webcam.
- Context mapper to identify webpage actionable elements (e.g., buttons, inputs, scroll regions).
- Intent Resolver for context-aware mapping from gaze to UI elements.
- Trigger appropriate response based on element type (e.g., open keyboard, click button)

[Back to top](#context-aware-gaze-based-interaction-for-users-with-motor-disabilities)


---

## Tech stack
- ![WebGazer.js](https://img.shields.io/badge/WebGazer.js-333?style=for-the-badge&logo=javascript&logoColor=F7DF1E)
- ![MediaPipe](https://img.shields.io/badge/MediaPipe-FF6F00?style=for-the-badge&logo=google&logoColor=white)
- ![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=000)
- ![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
- ![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
- ![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)

> More tools will be added as the project evolves.

[Back to top](#context-aware-gaze-based-interaction-for-users-with-motor-disabilities)

---


## Datasets

###  Existing Datasets

- **[GazeCapture](https://gazecapture.csail.mit.edu/)**  
  ~1.5 million webcam-based gaze points. Used to test WebGazer.js accuracy.  
  Format: CSV (x, y, timestamp) • License: MIT

- **[Rico Dataset](https://interactionmining.org/rico)**  
  72K Android UI layouts with element annotations.  
  Format: JSON (bounding boxes, element types) • License: CC-BY

### Planned Datasets

- **Real User Gaze Data**  
  Target: 10–15 users with motor disabilities.  
  Format: CSV (timestamp, gaze_x, gaze_y, element_id, action)

- **Synthetic Gaze Data**  
  Generated programmatically using JS/Python.  
  Format: CSV (gaze_x, gaze_y, element_id, noise_level)

> Full details in [`docs/dataset-overview.md`](docs/dataset-overview.md)

[Back to top](#context-aware-gaze-based-interaction-for-users-with-motor-disabilities)

---
### Evaluation Criteria
- **Accuracy** : The percentage of correctly performing the intended function
- **False Positive** : The rate of incorrect or unintended actions
- **Task Completion Time** : The time taken by users to perform the intended task
- **User Feedback** : Feedback collected from real users (qualitative), e.g., satisfaction and comfort

## Installation
- This section is under development.
  
[Back to top](#context-aware-gaze-based-interaction-for-users-with-motor-disabilities)


---
## Usage
- Usage instructions will be added after the prototype is ready.

[Back to top](#context-aware-gaze-based-interaction-for-users-with-motor-disabilities)

---
## License
[MIT License](https://choosealicense.com/licenses/mit/)

[Back to top](#context-aware-gaze-based-interaction-for-users-with-motor-disabilities)

---



[Research Internship Tracking Link](https://docs.google.com/spreadsheets/d/1a3_x1lYoI29PlsTCBJ-RwOVxCyfKYMAR/edit?usp=sharing&ouid=104954934820321621733&rtpof=true&sd=true)

#how to run training 

cd training 
npm init -y   
npm install @tensorflow/tfjs-node csv-parser
node train.js