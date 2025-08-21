const fs = require('fs');
const csv = require('csv-parser');

let errors = [];
let perPointErrors = {};
let examples = [];
const NUM_EXAMPLES = 5; // how many random samples to keep
let seen = 0;

fs.createReadStream('gaze_data.csv')
  .pipe(csv())
  .on('data', (row) => {
    const gx = parseFloat(row.gaze_x);
    const gy = parseFloat(row.gaze_y);
    const tx = parseFloat(row.target_x);
    const ty = parseFloat(row.target_y);

    if (!isNaN(gx) && !isNaN(gy) && !isNaN(tx) && !isNaN(ty)) {
      const dx = gx - tx;
      const dy = gy - ty;
      const dist = Math.sqrt(dx * dx + dy * dy);

      errors.push(dist);

      const key = `${tx},${ty}`;
      if (!perPointErrors[key]) perPointErrors[key] = [];
      perPointErrors[key].push(dist);

      // ---- Reservoir sampling for random examples ----
      seen++;
      if (examples.length < NUM_EXAMPLES) {
        examples.push({ tx, ty, gx, gy, dist });
      } else {
        const j = Math.floor(Math.random() * seen);
        if (j < NUM_EXAMPLES) {
          examples[j] = { tx, ty, gx, gy, dist };
        }
      }
    }
  })
  .on('end', () => {
    console.log(`✅ Processed ${errors.length} samples`);

    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    const sorted = [...errors].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const maxError = Math.max(...errors);

    console.log(`📊 Mean error: ${mean.toFixed(2)} px`);
    console.log(`📌 Median error: ${median.toFixed(2)} px`);
    console.log(`❌ Max error: ${maxError.toFixed(2)} px`);

    console.log("\n🔎 Per‑calibration point accuracy:");
    for (const [point, errs] of Object.entries(perPointErrors)) {
      const avg = errs.reduce((a, b) => a + b, 0) / errs.length;
      console.log(`  🎯 Target ${point} → avg error ${avg.toFixed(2)} px (${errs.length} samples)`);
    }

    console.log("\n📌 Random Example Samples:");
    examples.forEach(e => {
      console.log(
        `  🎯 Target (${e.tx}, ${e.ty}) → Sample (${e.gx}, ${e.gy}) → Error ${e.dist.toFixed(2)} px`
      );
    });
  });
