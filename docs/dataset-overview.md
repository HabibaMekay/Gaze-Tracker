# Dataset Overview

This document describes both the external and custom datasets used in the project.

---

## Existing Datasets

### 1. GazeCapture  
- Source: [https://gazecapture.csail.mit.edu/](https://gazecapture.csail.mit.edu/)  
- Description: ~1.5 million gaze points from webcam users. Mobile-focused.
- Format: CSV (x, y, timestamp)
- Use: Evaluate webcam gaze tracking (e.g., WebGazer.js)
- License: MIT

---

### 2. Rico Dataset  
- Source: [https://interactionmining.org/rico](https://interactionmining.org/rico)  
- Description: 72,000 Android UI layouts with annotated elements
- Format: JSON (bounding boxes, UI structure, element types)
- Use: Train/test the context mapper module
- License: CC-BY

---

##  Planned / Custom Datasets

### 3. Real User Gaze Data  
- Participants: 10–15 users with motor disabilities (e.g., ALS, cerebral palsy)
- Method: Record gaze via WebGazer.js on test webpages
- Format: CSV (timestamp, gaze_x, gaze_y, element_id, action)
- Use: Test system usability and robustness

---

### 4. Synthetic Gaze Data  
- Method: Simulated gaze points with noise around real UI elements
- Tools: Python scripts, DOM element positions
- Format: CSV (gaze_x, gaze_y, element_id, noise_level)
- Use: Benchmark accuracy filtering techniques (temporal smoothing, dwell time)

---

