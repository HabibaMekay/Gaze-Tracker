const tf = require('@tensorflow/tfjs-node'); // TensorFlow.js for Node.js
const fs = require('fs'); // allow reading files
const csv = require('csv-parser'); //liberary to parse CSV files (parse line by line and convert to JSON)

const irisData = [];  // stores input ( where the iris is located)
const gazeData = []; // stores output ( where the user is looking)


fs.createReadStream('gaze_data.csv') // read the CSV file (opens a stram to read file data)
  .pipe(csv()) // parse the CSV file
  .on('data', (row) => { // for each row in the CSV file
    const leftX = parseFloat(row.left_iris_x); // convert string to float
    const leftY = parseFloat(row.left_iris_y);
    const rightX = parseFloat(row.right_iris_x);
    const rightY = parseFloat(row.right_iris_y);
    const gazeX = parseFloat(row.gaze_x);
    const gazeY = parseFloat(row.gaze_y);

    irisData.push([leftX, leftY, rightX, rightY]); // add to the input array
    gazeData.push([gazeX, gazeY]); // add to the output array
  }) 
  .on('end', async () => {
    console.log(` Loaded ${irisData.length} samples`); // log after reading the file

    const xs = tf.tensor2d(irisData);   // convert js array to tensor (ds tensor understands)
    const ys = tf.tensor2d(gazeData); 

    const model = tf.sequential(); // create a sequential model
    model.add(tf.layers.dense({ inputShape: [4], units: 32, activation: 'relu' })); //takes 4 input values , has 32 neurons , ReLU to introduce non linearity 
    model.add(tf.layers.dense({ units: 32, activation: 'relu' })); // hidden layer 
    model.add(tf.layers.dense({ units: 2 })); // output layer (returns the final prediction x,y)

    model.compile({ optimizer: 'adam', loss: 'meanSquaredError' }); // use adam optimizer to optimize the model, mean squared error as loss function

    
    console.log(" Training");
    await model.fit(xs, ys, {
      epochs: 50, // pass through the data 50 times
      batchSize: 32, // train on 32 samples at a time
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          console.log(`Epoch ${epoch + 1}: loss = ${logs.loss.toFixed(4)}`); // log currunt loss value after each epoch
        }
      }
    });

    
    await model.save('./model/model.json'); // save the model to use it later 
    console.log("saved");
  });
