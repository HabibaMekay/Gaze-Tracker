// const tf = require('@tensorflow/tfjs-node');
// const fs = require('fs');
// const csv = require('csv-parser');

// const irisData = [];
// const gazeData = [];

// fs.createReadStream('gaze_data.csv')
//   .pipe(csv())
//   .on('data', (row) => {
//     irisData.push([
//       parseFloat(row.left_iris_x),
//       parseFloat(row.left_iris_y),
//       parseFloat(row.right_iris_x),
//       parseFloat(row.right_iris_y)
//     ]);
//     gazeData.push([parseFloat(row.gaze_x), parseFloat(row.gaze_y)]);
//   })
//   .on('end', async () => {
//     console.log(`Loaded ${irisData.length} samples`);

//     const xs = tf.tensor2d(irisData);
//     const ys = tf.tensor2d(gazeData);

//     const model = tf.sequential();
//     model.add(tf.layers.dense({ inputShape: [4], units: 32, activation: 'relu' }));
//     model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
//     model.add(tf.layers.dense({ units: 2 }));

//     model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });

//     console.log("Training...");
//     await model.fit(xs, ys, {
//       epochs: 50,
//       batchSize: 32,
//       callbacks: {
//         onEpochEnd: (epoch, logs) => {
//           console.log(`Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(4)}`);
//         }
//       }
//     });

//     // Ensure the directory exists
//     const modelDir = './model';
//     if (!fs.existsSync(modelDir)) {
//       fs.mkdirSync(modelDir, { recursive: true });
//     }

//     // Save the model with 'file://' prefix
//     await model.save(`file://${modelDir}/model.json`);
//     console.log("Model saved successfully!");
//   });

// const tf = require('@tensorflow/tfjs-node');
// const fs = require('fs');
// const csv = require('csv-parser');

// const irisData = [];
// const gazeData = [];

// fs.createReadStream('gaze_data.csv')
//   .pipe(csv())
//   .on('data', (row) => {
//     // Skip rows with missing data (essential for training)
//     if (
//       row.left_iris_x && row.left_iris_y &&
//       row.right_iris_x && row.right_iris_y &&
//       row.gaze_x && row.gaze_y
//     ) {
//       irisData.push([
//         parseFloat(row.left_iris_x),
//         parseFloat(row.left_iris_y),
//         parseFloat(row.right_iris_x),
//         parseFloat(row.right_iris_y)
//       ]);

//       // Normalize gaze_x and gaze_y from 0–1 (if your grid is 20x20 or resolution-based)
//       gazeData.push([
//         parseFloat(row.gaze_x) / 20,   // 🔁 Normalize if using 20x20 grid
//         parseFloat(row.gaze_y) / 20
//       ]);
//     }
//   })
//   .on('end', async () => {
//     console.log(`Loaded ${irisData.length} samples`);

//     const xs = tf.tensor2d(irisData);
//     const ys = tf.tensor2d(gazeData);

//     // Model definition
//     const model = tf.sequential();
//     model.add(tf.layers.dense({ inputShape: [4], units: 32, activation: 'relu' }));
//     model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
//     model.add(tf.layers.dense({ units: 2 })); // Output is [gaze_x, gaze_y]

//     model.compile({
//       optimizer: tf.train.adam(),
//       loss: 'meanSquaredError'
//     });

//     console.log("Training...");
//     await model.fit(xs, ys, {
//       epochs: 100,
//       batchSize: 32,
//       callbacks: {
//         onEpochEnd: (epoch, logs) => {
//           console.log(`Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(5)}`);
//         }
//       }
//     });

//     // Create model directory if not exists
//     const modelDir = './model';
//     if (!fs.existsSync(modelDir)) {
//       fs.mkdirSync(modelDir, { recursive: true });
//     }

//     // Save trained model to filesystem
//     await model.save(`file://${modelDir}/model.json`);
//     console.log("✅ Model saved successfully in ./model folder");
//   });

const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const csv = require('csv-parser');

// Will read screen width/height from data instead of hardcoding
const irisData = [];
const gazeData = [];
const screenSizes = [];

class EarlyStopping {
    constructor({ monitor = 'val_loss', patience = 0, minDelta = 0 }) {
        this.monitor = monitor;
        this.patience = patience;
        this.minDelta = minDelta;
        this.best = Infinity;
        this.patienceCounter = 0;
        this.stopTraining = false;
    }

    onEpochEnd(epoch, logs) {
        const current = logs[this.monitor];
        if (current < this.best - this.minDelta) {
            this.best = current;
            this.patienceCounter = 0;
        } else {
            this.patienceCounter += 1;
            if (this.patienceCounter >= this.patience) {
                console.log(
                    `Early stopping: No improvement in ${this.monitor} for ${this.patience} epochs`
                );
                this.stopTraining = true;
            }
        }
    }
}

// Shuffle both arrays in sync
function shuffleInUnison(a, b, c) {
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
        [b[i], b[j]] = [b[j], b[i]];
        [c[i], c[j]] = [c[j], c[i]];
    }
}

fs.createReadStream('gaze_data.csv')
    .pipe(csv())
    .on('data', (row) => {
        const sw = parseFloat(row.screen_width);
        const sh = parseFloat(row.screen_height);
        const gx = parseFloat(row.gaze_x);
        const gy = parseFloat(row.gaze_y);

        if (
            row.left_iris_x && row.left_iris_y &&
            row.right_iris_x && row.right_iris_y &&
            gx >= 0 && gy >= 0 &&
            sw > 0 && sh > 0
        ) {
            irisData.push([
                parseFloat(row.left_iris_x),
                parseFloat(row.left_iris_y),
                parseFloat(row.right_iris_x),
                parseFloat(row.right_iris_y)
            ]);
            gazeData.push([gx / sw, gy / sh]); // normalized target
            screenSizes.push([sw, sh]);
        }
    })
    .on('end', async () => {
        console.log(`Loaded ${irisData.length} samples`);
        if (irisData.length === 0) return;

        // Shuffle before creating tensors
        shuffleInUnison(irisData, gazeData, screenSizes);

        const xs = tf.tensor2d(irisData);
        const ys = tf.tensor2d(gazeData);

        const model = tf.sequential();
        model.add(tf.layers.dense({ inputShape: [4], units: 64, activation: 'relu' }));
        model.add(tf.layers.dropout({ rate: 0.2 }));
        model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
        model.add(tf.layers.dropout({ rate: 0.2 }));
        model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
        model.add(tf.layers.dense({ units: 2 }));

        model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'meanSquaredError'
        });

        const earlyStopping = new EarlyStopping({
            monitor: 'val_loss',
            patience: 10,
            minDelta: 0.0001
        });

        console.log("Training...");
        await model.fit(xs, ys, {
            epochs: 200,
            batchSize: 32,
            validationSplit: 0.2,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    console.log(
                        `Epoch ${epoch + 1}: loss=${logs.loss.toFixed(5)}, val_loss=${logs.val_loss.toFixed(5)}`
                    );
                    earlyStopping.onEpochEnd(epoch, logs);
                },
                onBatchEnd: () => {
                    if (earlyStopping.stopTraining) return { stop: true };
                }
            }
        });

        // Test a sample: convert normalized prediction back to pixels
        const testSample = tf.tensor2d([irisData[0]]);
        const prediction = model.predict(testSample);
        const [predXNorm, predYNorm] = prediction.dataSync();

        const [sw, sh] = screenSizes[0];
        const predX = predXNorm * sw;
        const predY = predYNorm * sh;

        console.log("Predicted gaze (pixels):", [predX, predY]);
        console.log("Actual gaze (pixels):", [gazeData[0][0] * sw, gazeData[0][1] * sh]);

        const modelDir = './model';
        if (!fs.existsSync(modelDir)) fs.mkdirSync(modelDir, { recursive: true });
        await model.save(`file://${modelDir}/model.json`);
        console.log("✅ Model saved successfully in ./model folder");

        xs.dispose();
        ys.dispose();
        testSample.dispose();
        prediction.dispose();
    });
