"""
Test Model — Run sample images through the damage classifier and print results.
Usage:  python test_model.py
"""

import base64
import glob
import os
import sys
import time

# ─── Locate sample images ──────────────────────────────────────────
SAMPLE_DIR = os.path.join(os.path.dirname(__file__), "sample_images")

image_paths = sorted(
    glob.glob(os.path.join(SAMPLE_DIR, "*.png"))
    + glob.glob(os.path.join(SAMPLE_DIR, "*.jpg"))
    + glob.glob(os.path.join(SAMPLE_DIR, "*.jpeg"))
    + glob.glob(os.path.join(SAMPLE_DIR, "*.webp"))
)

if not image_paths:
    print("❌  No images found in", SAMPLE_DIR)
    sys.exit(1)

print(f"Found {len(image_paths)} sample image(s) in {SAMPLE_DIR}\n")

# ─── Load the model ────────────────────────────────────────────────
from ml_processor import DamageDetector  # noqa: E402

print()
detector = DamageDetector()
print()

# ─── Run inference ─────────────────────────────────────────────────
SEP = "═" * 72

for img_path in image_paths:
    filename = os.path.basename(img_path)
    print(SEP)
    print(f"  📷  Image: {filename}")
    print(SEP)

    # Read & base64-encode the image
    with open(img_path, "rb") as f:
        img_b64 = base64.b64encode(f.read()).decode("utf-8")

    # Time the prediction
    t0 = time.perf_counter()
    result = detector.predict(img_b64)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    # ── Pretty-print results ────────────────────────────────────────
    damage_class = result["damage_class"]
    severity = result["severity"]
    severity_label = result["severity_label"]
    confidence = result["confidence"]
    damage_type = result["type"]
    probs = result["probabilities"]

    status_icon = "✅" if damage_type == "good" else "🔴"

    print(f"  Status        : {status_icon}  {damage_type.upper()}")
    print(f"  Damage Class  : {damage_class}")
    print(f"  Severity      : {severity}/10  ({severity_label})")
    print(f"  Confidence    : {confidence:.0%}")
    print(f"  Inference Time: {elapsed_ms:.1f} ms")
    print()

    # Probability distribution bar chart
    print("  Probability Distribution:")
    max_prob = max(probs.values()) if probs else 1
    for cls_name, prob_val in probs.items():
        bar_len = int((prob_val / max(max_prob, 1)) * 30)
        bar = "█" * bar_len + "░" * (30 - bar_len)
        marker = " ◀" if cls_name == damage_class else ""
        print(f"    {cls_name:>10s}  {bar}  {prob_val:5.1f}%{marker}")

    print()

print(SEP)
print(f"  Done — processed {len(image_paths)} image(s).")
print(SEP)
