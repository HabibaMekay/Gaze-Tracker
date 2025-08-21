const tf = require('@tensorflow/tfjs-node');
const fs = require('fs');
const csv = require('csv-parser');

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
                console.log(`Early stopping: No improvement in ${this.monitor} for ${this.patience} epochs`);
                this.stopTraining = true;
            }
        }
    }
}

// Keep shuffle function the same
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
        const tx = parseFloat(row.target_x);
        const ty = parseFloat(row.target_y);

    if (
                row.left_iris_x && row.left_iris_y &&
                row.right_iris_x && row.right_iris_y &&
                tx >= 0 && ty >= 0 &&
                sw > 0 && sh > 0
            ) {
                irisData.push([
                    parseFloat(row.left_iris_x),
                    parseFloat(row.left_iris_y),
                    parseFloat(row.right_iris_x),
                    parseFloat(row.right_iris_y)
                ]);
                gazeData.push([tx / sw, ty / sh]); // normalized
                screenSizes.push([sw, sh]);
            }

    })
    .on('end', async () => {
        console.log(`Loaded ${irisData.length} samples`);
        if (irisData.length === 0) return;

        // === 🆕 Shuffle before splitting
        shuffleInUnison(irisData, gazeData, screenSizes);

        // === 🆕 30% train, 70% test
        const trainSize = Math.floor(irisData.length * 0.3);
        const trainIris = irisData.slice(0, trainSize);
        const trainGaze = gazeData.slice(0, trainSize);
        const testIris = irisData.slice(trainSize);
        const testGaze = gazeData.slice(trainSize);
        const testScreens = screenSizes.slice(trainSize);

        console.log(`Training samples: ${trainIris.length}`);
        console.log(`Testing samples: ${testIris.length}`);

        const xs = tf.tensor2d(trainIris);
        const ys = tf.tensor2d(trainGaze);

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
                    console.log(`Epoch ${epoch + 1}: loss=${logs.loss.toFixed(5)}, val_loss=${logs.val_loss.toFixed(5)}`);
                    earlyStopping.onEpochEnd(epoch, logs);
                },
                onBatchEnd: () => {
                    if (earlyStopping.stopTraining) return { stop: true };
                }
            }
        });

        // === 📊 Evaluation on TEST set ===
        let totalError = 0;
        let within50 = 0, within100 = 0;
        const numSamples = 20; // test on 20 random samples from test set

        for (let i = 0; i < numSamples; i++) {
            const idx = Math.floor(Math.random() * testIris.length);
            const sample = tf.tensor2d([testIris[idx]]);
            const prediction = model.predict(sample);
            const [predXNorm, predYNorm] = prediction.dataSync();

            const [sw, sh] = testScreens[idx];
            const predX = predXNorm * sw;
            const predY = predYNorm * sh;
            const actualX = testGaze[idx][0] * sw;
            const actualY = testGaze[idx][1] * sh;

            const error = Math.sqrt((predX - actualX) ** 2 + (predY - actualY) ** 2);
            totalError += error;

            if (error <= 50) within50++;
            if (error <= 100) within100++;

            console.log(`Test Sample ${i + 1}: Pred=(${predX.toFixed(2)}, ${predY.toFixed(2)}), Actual=(${actualX}, ${actualY}), Error=${error.toFixed(2)} px`);

            sample.dispose();
            prediction.dispose();
        }

        console.log(`\n📊 Mean error over ${numSamples} test samples: ${(totalError / numSamples).toFixed(2)} px`);
        console.log(`✅ % within 50 px: ${(within50 / numSamples * 100).toFixed(1)}%`);
        console.log(`✅ % within 100 px: ${(within100 / numSamples * 100).toFixed(1)}%`);
        // === End Evaluation Block ===

        const modelDir = './model';
        if (!fs.existsSync(modelDir)) fs.mkdirSync(modelDir, { recursive: true });
        await model.save(`file://${modelDir}/model.json`);
        console.log("✅ Model saved successfully in ./model folder");

        xs.dispose();
        ys.dispose();
    });
