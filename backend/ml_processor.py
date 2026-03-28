"""
ML Damage Detection Processor — Real MobileNetV2 Model
-------------------------------------------------------
Uses the fine-tuned MobileNetV2 damage classifier (damage_classifier.pth)
to run actual inference on drone imagery.

Model output classes (5 severity levels):
  - no_damage  (index 0)
  - low        (index 1)
  - medium     (index 2)
  - high       (index 3)
  - severe     (index 4)

Each prediction returns:
  - type: one of "damage" or "good"
  - severity: integer scale 1–10
  - severity_label: human-readable severity text
  - confidence: model confidence score (0.0–1.0)
  - damage_class: raw model class label
  - probabilities: full probability distribution across all 5 classes
"""

import base64
import io
import os
import time
import uuid

import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models, transforms
from PIL import Image, ImageDraw, ImageFont

# ─── Model Configuration ────────────────────────────────────────────
MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "ml", "damage_classifier.pth")
IMG_SIZE = 224
CLASS_ORDER = ["no_damage", "low", "medium", "high", "severe"]

# ─── Damage Categories (for annotation colours) ─────────────────────
DAMAGE_CATEGORIES = {
    "no_damage": {"color": "#44CC66", "label": "No Damage"},
    "low":       {"color": "#FFD700", "label": "Low Damage"},
    "medium":    {"color": "#FF8C00", "label": "Medium Damage"},
    "high":      {"color": "#FF4422", "label": "High Damage"},
    "severe":    {"color": "#FF2266", "label": "Severe Damage"},
    "good":      {"color": "#44CC66", "label": "No Damage"},
    "damage":    {"color": "#FF4422", "label": "Damage Detected"},
}

# Map model class → severity range (mapped onto 1–10 scale)
CLASS_SEVERITY_MAP = {
    "no_damage": 1,
    "low":       3,
    "medium":    5,
    "high":      7,
    "severe":    9,
}

SEVERITY_LABELS = {
    1: "None",
    2: "Minimal",
    3: "Low",
    4: "Moderate",
    5: "Significant",
    6: "High",
    7: "Severe",
    8: "Very Severe",
    9: "Critical",
    10: "Catastrophic",
}


def _get_severity_label(severity: int) -> str:
    return SEVERITY_LABELS.get(severity, "Unknown")


def _build_model(num_classes: int) -> nn.Module:
    """Build the MobileNetV2 model with the custom classifier head."""
    model = models.mobilenet_v2(weights=None)
    in_features = model.classifier[1].in_features
    model.classifier = nn.Sequential(
        nn.Dropout(0.4),
        nn.Linear(in_features, 256),
        nn.ReLU(),
        nn.Dropout(0.3),
        nn.Linear(256, num_classes),
    )
    return model


def _compute_severity(pred_class: str, confidence: float, probs: list) -> int:
    """
    Compute a 1–10 severity score from the model prediction.

    Uses the base severity for the predicted class, then adjusts ±1
    based on confidence and the probability distribution.
    """
    base = CLASS_SEVERITY_MAP.get(pred_class, 5)

    if pred_class == "no_damage":
        return 1

    # Adjust severity based on confidence
    if confidence > 0.90:
        adjustment = 1
    elif confidence < 0.60:
        adjustment = -1
    else:
        adjustment = 0

    severity = base + adjustment
    return max(1, min(10, severity))


# ─── Image Transform (matches training pipeline) ────────────────────
_transform = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


class DamageDetector:
    """
    Real MobileNetV2-based damage detector.
    Drop-in replacement — same predict() and process_frame() interface.
    """

    def __init__(self, min_detections: int = 1, max_detections: int = 5):
        self.min_detections = min_detections
        self.max_detections = max_detections
        self.frame_count = 0

        # ── Load the model ───────────────────────────────────────────
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        resolved_path = os.path.abspath(MODEL_PATH)
        if not os.path.exists(resolved_path):
            raise FileNotFoundError(
                f"Model file not found: {resolved_path}\n"
                f"Place damage_classifier.pth in the ml/ directory."
            )

        self.model = _build_model(len(CLASS_ORDER))
        checkpoint = torch.load(resolved_path, map_location=self.device, weights_only=False)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.to(self.device).eval()

        # Use class names from checkpoint if available
        self.class_order = checkpoint.get("class_names", CLASS_ORDER)

        print(f"[ML] ✅ Loaded damage_classifier.pth on {self.device}")
        print(f"[ML]    Classes: {self.class_order}")

    # ─── Single Image Prediction (Simple API) ────────────────────────

    def predict(self, image_b64: str) -> dict:
        """
        Predict damage severity for a single image.

        Args:
            image_b64: Base64-encoded image string (JPEG/PNG)

        Returns:
            dict with keys:
                - type: "damage" | "good"
                - severity: int 1–10
                - severity_label: human-readable severity
                - confidence: float 0.0–1.0
                - damage_class: raw model class (no_damage|low|medium|high|severe)
                - probabilities: dict of class → probability
        """
        # Decode base64 → PIL Image
        image_data = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_data)).convert("RGB")

        # Transform and run inference
        tensor = _transform(image).unsqueeze(0).to(self.device)

        with torch.no_grad():
            logits = self.model(tensor)
            probs = F.softmax(logits, dim=1).squeeze().tolist()

        pred_idx = int(torch.tensor(probs).argmax())
        pred_class = self.class_order[pred_idx]
        confidence = round(probs[pred_idx], 4)

        # Map to the backend interface
        damage_type = "good" if pred_class == "no_damage" else "damage"
        severity = _compute_severity(pred_class, confidence, probs)

        return {
            "type": damage_type,
            "severity": severity,
            "severity_label": _get_severity_label(severity),
            "confidence": round(confidence, 2),
            "damage_class": pred_class,
            "probabilities": {
                cls: round(p * 100, 1) for cls, p in zip(self.class_order, probs)
            },
        }

    # ─── Full Frame Processing (for WebSocket streaming) ─────────────

    def process_frame(self, image_b64: str) -> dict:
        """
        Process a base64-encoded image and return annotated image + detections.

        Args:
            image_b64: Base64-encoded image string (JPEG/PNG)

        Returns:
            dict with keys:
                - image: base64-encoded annotated image
                - detections: list of detection dicts
                - prediction: overall prediction (type + severity)
                - processing_time_ms: time taken in ms
                - frame_id: unique frame identifier
                - total_damage_count: number of damage detections
                - summary: summary dict
        """
        start_time = time.time()
        self.frame_count += 1

        # Decode the incoming image
        image_data = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_data)).convert("RGB")
        width, height = image.size

        # Run real inference
        prediction = self.predict(image_b64)

        # Build detections list
        detections = []

        if prediction["type"] != "good":
            damage_class = prediction["damage_class"]
            cat_color = DAMAGE_CATEGORIES.get(damage_class, DAMAGE_CATEGORIES["damage"])["color"]

            # Create a single centred detection box scaled by severity
            severity_ratio = prediction["severity"] / 10.0
            box_w = int(width * max(0.15, severity_ratio * 0.6))
            box_h = int(height * max(0.15, severity_ratio * 0.6))
            x1 = (width - box_w) // 2
            y1 = (height - box_h) // 2
            x2 = x1 + box_w
            y2 = y1 + box_h

            detections.append({
                "id": str(uuid.uuid4())[:8],
                "label": damage_class,
                "confidence": prediction["confidence"],
                "severity": prediction["severity"],
                "severity_label": prediction["severity_label"],
                "color": cat_color,
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "area_px": box_w * box_h,
            })

        # Annotate the image
        annotated_image = self._annotate_image(image, detections, prediction)

        # Encode result
        buffer = io.BytesIO()
        annotated_image.save(buffer, format="JPEG", quality=85)
        annotated_b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

        processing_time = round((time.time() - start_time) * 1000, 1)

        return {
            "image": annotated_b64,
            "detections": detections,
            "prediction": prediction,
            "processing_time_ms": processing_time,
            "frame_id": f"frame_{self.frame_count:06d}",
            "total_damage_count": len(detections),
            "summary": self._generate_summary(detections, prediction),
        }

    def _annotate_image(self, image: Image.Image, detections: list, prediction: dict) -> Image.Image:
        """Draw bounding boxes, labels, and overall prediction on the image."""
        annotated = image.copy()
        draw = ImageDraw.Draw(annotated)

        # Try to use a decent font, fall back to default
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
            font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 11)
            font_large = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
        except (OSError, IOError):
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
                font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 11)
                font_large = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
            except (OSError, IOError):
                font = ImageFont.load_default()
                font_small = font
                font_large = font

        # Draw overall prediction banner at the top
        damage_class = prediction.get("damage_class", prediction["type"])
        pred_severity = prediction["severity"]
        pred_color = DAMAGE_CATEGORIES.get(damage_class, DAMAGE_CATEGORIES["damage"])["color"]
        conf_pct = prediction["confidence"] * 100

        banner_text = (
            f"  {damage_class.upper()}  |  "
            f"Severity: {pred_severity}/10 ({prediction['severity_label']})  |  "
            f"Conf: {conf_pct:.1f}%  "
        )

        text_bbox = draw.textbbox((0, 0), banner_text, font=font_large)
        text_h = text_bbox[3] - text_bbox[1]
        banner_h = text_h + 16

        # Semi-transparent banner background
        overlay = Image.new("RGBA", annotated.size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.rectangle([0, 0, annotated.width, banner_h], fill=(0, 0, 0, 180))
        annotated = Image.alpha_composite(annotated.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(annotated)

        draw.text((10, 8), banner_text, fill=pred_color, font=font_large)

        # Model tag (bottom-right corner)
        tag = "🧠 MobileNetV2"
        tag_bbox = draw.textbbox((0, 0), tag, font=font_small)
        tag_w = tag_bbox[2] - tag_bbox[0]
        tag_h = tag_bbox[3] - tag_bbox[1]
        draw.rectangle(
            [
                annotated.width - tag_w - 12,
                annotated.height - tag_h - 10,
                annotated.width,
                annotated.height,
            ],
            fill=(0, 0, 0, 160),
        )
        draw.text(
            (annotated.width - tag_w - 6, annotated.height - tag_h - 5),
            tag,
            fill="#AAAAAA",
            font=font_small,
        )

        # Draw probability bar (bottom-left)
        probs = prediction.get("probabilities", {})
        if probs:
            bar_y = annotated.height - 18
            bar_x = 8
            for cls_name in self.class_order:
                prob_val = probs.get(cls_name, 0.0)
                cls_color = DAMAGE_CATEGORIES.get(cls_name, DAMAGE_CATEGORIES["damage"])["color"]
                prob_text = f"{cls_name}: {prob_val:.1f}%"
                draw.text((bar_x, bar_y), prob_text, fill=cls_color, font=font_small)
                prob_bbox = draw.textbbox((0, 0), prob_text, font=font_small)
                bar_x += (prob_bbox[2] - prob_bbox[0]) + 12

        # Draw bounding boxes for individual detections
        for det in detections:
            bbox = det["bbox"]
            color = det["color"]
            label = det["label"]
            confidence = det["confidence"]
            severity_label = det["severity_label"]
            severity = det["severity"]

            x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]

            # Draw bounding box (thicker outline)
            for i in range(3):
                draw.rectangle([x1 - i, y1 - i, x2 + i, y2 + i], outline=color)

            # Draw label background
            label_text = f"{label} {confidence:.0%}"
            severity_text = f"[Severity: {severity}/10 — {severity_label}]"

            # Get text dimensions
            text_bbox = draw.textbbox((0, 0), label_text, font=font)
            text_w = text_bbox[2] - text_bbox[0]
            text_h = text_bbox[3] - text_bbox[1]

            sev_bbox = draw.textbbox((0, 0), severity_text, font=font_small)
            sev_w = sev_bbox[2] - sev_bbox[0]

            total_w = max(text_w, sev_w) + 12
            total_h = text_h + 20

            # Label background
            draw.rectangle(
                [x1, y1 - total_h - 4, x1 + total_w, y1],
                fill=color,
            )

            # Label text
            draw.text((x1 + 4, y1 - total_h - 2), label_text, fill="white", font=font)
            draw.text((x1 + 4, y1 - 16), severity_text, fill="white", font=font_small)

            # Corner markers
            marker_len = min(15, (x2 - x1) // 4)
            for corner_x, corner_y, dx, dy in [
                (x1, y1, 1, 1), (x2, y1, -1, 1),
                (x1, y2, 1, -1), (x2, y2, -1, -1)
            ]:
                draw.line([(corner_x, corner_y), (corner_x + dx * marker_len, corner_y)],
                          fill=color, width=3)
                draw.line([(corner_x, corner_y), (corner_x, corner_y + dy * marker_len)],
                          fill=color, width=3)

        return annotated

    def _generate_summary(self, detections: list, prediction: dict) -> dict:
        """Generate a summary of all detections."""
        if prediction["type"] == "good":
            return {
                "status": "good",
                "type": "good",
                "severity": 1,
                "severity_label": "None",
                "damage_class": "no_damage",
                "message": "No damage detected — area looks good",
            }

        damage_counts = {}
        max_severity = 0
        for det in detections:
            label = det["label"]
            damage_counts[label] = damage_counts.get(label, 0) + 1
            max_severity = max(max_severity, det["severity"])

        return {
            "status": "damage_detected",
            "type": prediction["type"],
            "damage_class": prediction.get("damage_class", "unknown"),
            "severity": prediction["severity"],
            "severity_label": prediction["severity_label"],
            "total_detections": len(detections),
            "damage_types": damage_counts,
            "max_severity": max_severity,
            "max_severity_label": _get_severity_label(max_severity),
            "probabilities": prediction.get("probabilities", {}),
        }
