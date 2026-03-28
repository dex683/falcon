"""
Disaster Damage Prediction App — Flask UI
Run: python predict_app.py
Open: http://localhost:5051
"""

import os
import io
import json
import uuid
import base64
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models, transforms
from PIL import Image
from flask import Flask, render_template, request, jsonify, send_from_directory

# ── Config ───────────────────────────────────────────────────────────────────
MODEL_DIR   = Path(__file__).parent
MODEL_PATH  = MODEL_DIR / 'damage_classifier.pth'
UPLOAD_DIR  = MODEL_DIR / 'uploads'
UPLOAD_DIR.mkdir(exist_ok=True)

IMG_SIZE = 224
CLASS_ORDER = ['no_damage', 'low', 'medium', 'high', 'severe']
CLASS_COLORS = {
    'no_damage': '#64748b',
    'low':       '#22c55e',
    'medium':    '#f59e0b',
    'high':      '#f97316',
    'severe':    '#ef4444',
}
CLASS_ICONS = {
    'no_damage': '🟢',
    'low':       '🟡',
    'medium':    '🟠',
    'high':      '🔴',
    'severe':    '⛔',
}

# ── Model Loading ─────────────────────────────────────────────────────────────
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
model  = None

INFER_TF = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


def build_model(num_classes):
    m = models.mobilenet_v2(weights=None)
    in_features = m.classifier[1].in_features
    m.classifier = nn.Sequential(
        nn.Dropout(0.4),
        nn.Linear(in_features, 256),
        nn.ReLU(),
        nn.Dropout(0.3),
        nn.Linear(256, num_classes),
    )
    return m


def load_model():
    global model
    if not MODEL_PATH.exists():
        return False
    ckpt  = torch.load(MODEL_PATH, map_location=device)
    model = build_model(len(CLASS_ORDER))
    model.load_state_dict(ckpt['model_state_dict'])
    model.to(device).eval()
    return True


def predict_image(img: Image.Image):
    tensor = INFER_TF(img).unsqueeze(0).to(device)
    with torch.no_grad():
        logits = model(tensor)
        probs  = F.softmax(logits, dim=1).squeeze().cpu().tolist()
    pred_idx   = int(torch.tensor(probs).argmax())
    pred_label = CLASS_ORDER[pred_idx]
    return {
        'label':       pred_label,
        'confidence':  round(probs[pred_idx] * 100, 1),
        'color':       CLASS_COLORS[pred_label],
        'icon':        CLASS_ICONS[pred_label],
        'probabilities': [
            {
                'class':      c,
                'prob':       round(p * 100, 1),
                'color':      CLASS_COLORS[c],
            }
            for c, p in zip(CLASS_ORDER, probs)
        ],
    }


# ── Flask App ─────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB

model_loaded = load_model()


@app.route('/')
def index():
    return render_template('predict.html',
                           model_ready=model_loaded,
                           classes=CLASS_ORDER,
                           colors=CLASS_COLORS)


@app.route('/predict', methods=['POST'])
def predict():
    if not model_loaded:
        return jsonify({'error': 'Model not loaded. Run train.py first.'}), 503

    file = request.files.get('image')
    if not file:
        return jsonify({'error': 'No image provided'}), 400

    try:
        img = Image.open(io.BytesIO(file.read())).convert('RGB')
        # Save for display
        fname = f'{uuid.uuid4().hex}.jpg'
        img.save(UPLOAD_DIR / fname)
        result = predict_image(img)
        result['filename'] = fname
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/uploads/<filename>')
def serve_upload(filename):
    return send_from_directory(UPLOAD_DIR, filename)


@app.route('/status')
def status():
    return jsonify({'model_ready': model_loaded, 'device': str(device)})


if __name__ == '__main__':
    print('Disaster Damage Predictor — http://localhost:5051')
    print(f'Model loaded: {model_loaded}')
    app.run(debug=False, port=5051)
