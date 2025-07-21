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

const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const csv = require('csv-parser');

const irisData = [];
const gazeData = [];

fs.createReadStream('gaze_data.csv')
  .pipe(csv())
  .on('data', (row) => {
    // Skip rows with missing data (essential for training)
    if (
      row.left_iris_x && row.left_iris_y &&
      row.right_iris_x && row.right_iris_y &&
      row.gaze_x && row.gaze_y
    ) {
      irisData.push([
        parseFloat(row.left_iris_x),
        parseFloat(row.left_iris_y),
        parseFloat(row.right_iris_x),
        parseFloat(row.right_iris_y)
      ]);

      // Normalize gaze_x and gaze_y from 0–1 (if your grid is 20x20 or resolution-based)
      gazeData.push([
        parseFloat(row.gaze_x) / 20,   // 🔁 Normalize if using 20x20 grid
        parseFloat(row.gaze_y) / 20
      ]);
    }
  })
  .on('end', async () => {
    console.log(`Loaded ${irisData.length} samples`);

    const xs = tf.tensor2d(irisData);
    const ys = tf.tensor2d(gazeData);

    // Model definition
    const model = tf.sequential();
    model.add(tf.layers.dense({ inputShape: [4], units: 32, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 2 })); // Output is [gaze_x, gaze_y]

    model.compile({
      optimizer: tf.train.adam(),
      loss: 'meanSquaredError'
    });

    console.log("Training...");
    await model.fit(xs, ys, {
      epochs: 50,
      batchSize: 32,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          console.log(`Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(5)}`);
        }
      }
    });

    // Create model directory if not exists
    const modelDir = './model';
    if (!fs.existsSync(modelDir)) {
      fs.mkdirSync(modelDir, { recursive: true });
    }

    // Save trained model to filesystem
    await model.save(`file://${modelDir}/model.json`);
    console.log("✅ Model saved successfully in ./model folder");
  });

