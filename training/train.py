import pandas as pd
import numpy as np
import os
from sklearn.utils import shuffle
from sklearn.preprocessing import MinMaxScaler
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error

# Load and process data (same as above, with feature engineering)
iris_data = []
gaze_data = []
screen_sizes = []

df = pd.read_csv('gaze_data.csv')
for _, row in df.iterrows():
    sw = float(row['screen_width'])
    sh = float(row['screen_height'])
    tx = float(row['target_x'])
    ty = float(row['target_y'])

    if (pd.notna(row['left_iris_x']) and pd.notna(row['left_iris_y']) and
        pd.notna(row['right_iris_x']) and pd.notna(row['right_iris_y']) and
        tx >= 0 and ty >= 0 and sw > 0 and sh > 0):
        left_x, left_y = float(row['left_iris_x']), float(row['left_iris_y'])
        right_x, right_y = float(row['right_iris_x']), float(row['right_iris_y'])

        dx = right_x - left_x
        dy = right_y - left_y
        mid_x = (left_x + right_x) / 2
        mid_y = (left_y + right_y) / 2

        iris_data.append([left_x, left_y, right_x, right_y, dx, dy, mid_x, mid_y])
        gaze_data.append([tx / sw, ty / sh])
        screen_sizes.append([sw, sh])

print(f"Loaded {len(iris_data)} samples")
if not iris_data:
    exit()

# Shuffle and normalize
iris_data, gaze_data, screen_sizes = shuffle(iris_data, gaze_data, screen_sizes, random_state=42)
scaler = MinMaxScaler()
iris_data = scaler.fit_transform(iris_data)

# Split
X_train, X_test, y_train, y_test, screens_train, screens_test = train_test_split(
    iris_data, gaze_data, screen_sizes, test_size=0.3, random_state=42
)

# Train RandomForest
model = RandomForestRegressor(n_estimators=200, max_depth=15, random_state=42)
model.fit(X_train, y_train)

# Predict and evaluate on full test set
predictions = model.predict(X_test)
errors = []
within_50 = 0
within_100 = 0

for i in range(len(X_test)):
    pred_x_norm, pred_y_norm = predictions[i]
    sw, sh = screens_test[i]
    pred_x = pred_x_norm * sw
    pred_y = pred_y_norm * sh
    actual_x = y_test[i][0] * sw
    actual_y = y_test[i][1] * sh

    error = np.sqrt((pred_x - actual_x) ** 2 + (pred_y - actual_y) ** 2)
    errors.append(error)

    if error <= 50:
        within_50 += 1
    if error <= 100:
        within_100 += 1

    if i < 20:
        print(f"Test Sample {i + 1}: Pred=({pred_x:.2f}, {pred_y:.2f}), Actual=({actual_x:.2f}, {actual_y:.2f}), Error={error:.2f} px")

# from sklearn.model_selection import cross_val_score
# scores = cross_val_score(model, iris_data, gaze_data, cv=5, scoring='neg_mean_squared_error')
# print("Cross-validated MSE:", -np.mean(scores))

mean_error = np.mean(errors)
print(f"\n📊 Mean error over {len(errors)} test samples: {mean_error:.2f} px")
print(f"✅ % within 50 px: {(within_50 / len(errors) * 100):.1f}%")
print(f"✅ % within 100 px: {(within_100 / len(errors) * 100):.1f}%")

# Save model (using joblib)
import joblib
model_dir = './model_rf'
os.makedirs(model_dir, exist_ok=True)
joblib.dump(model, os.path.join(model_dir, 'model_rf.pkl'))
print("✅ Model saved successfully in ./model_rf folder")