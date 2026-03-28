"""
ML Damage Detection Processor — Mock Model
--------------------------------------------
Mocked damage detector that simulates predictions with the target categories:
  - fire
  - flood
  - destruction
  - good

Each prediction returns:
  - type: one of the 4 categories
  - severity: integer scale 1–10 (1 = minimal, 10 = catastrophic)
  - severity_label: human-readable severity text
  - confidence: model confidence score (0.0–1.0)

Drop-in replaceable with the real YOLOv8 model by implementing the same
`predict()` and `process_frame()` interfaces.
"""

import base64
import io
import random
import time
import uuid

from PIL import Image, ImageDraw, ImageFont

# ─── Damage Categories ──────────────────────────────────────────────
DAMAGE_CATEGORIES = {
    "fire": {
        "color": "#FF4422",
        "severity_range": (3, 10),
        "weight": 0.25,  # probability weight
    },
    "flood": {
        "color": "#2288FF",
        "severity_range": (2, 9),
        "weight": 0.25,
    },
    "destruction": {
        "color": "#FF2266",
        "severity_range": (5, 10),
        "weight": 0.25,
    },
    "good": {
        "color": "#44CC66",
        "severity_range": (1, 1),  # always severity 1 (no damage)
        "weight": 0.25,
    },
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


class DamageDetector:
    """
    Mock damage detector for development.
    Swap this class for the real YOLOv8 model by keeping the same interface.
    """

    def __init__(self, min_detections: int = 1, max_detections: int = 5):
        self.min_detections = min_detections
        self.max_detections = max_detections
        self.frame_count = 0

    # ─── Single Image Prediction (Simple API) ────────────────────────

    def predict(self, image_b64: str) -> dict:
        """
        Predict damage type and severity for a single image.

        Args:
            image_b64: Base64-encoded image string (JPEG/PNG)

        Returns:
            dict with keys:
                - type: "fire" | "flood" | "destruction" | "good"
                - severity: int 1–10
                - severity_label: human-readable severity
                - confidence: float 0.0–1.0
        """
        # Simulate model inference delay (50–200ms)
        time.sleep(random.uniform(0.05, 0.2))

        # Pick a category weighted randomly
        categories = list(DAMAGE_CATEGORIES.keys())
        weights = [DAMAGE_CATEGORIES[c]["weight"] for c in categories]
        damage_type = random.choices(categories, weights=weights, k=1)[0]

        cat = DAMAGE_CATEGORIES[damage_type]

        if damage_type == "good":
            severity = 1
            confidence = round(random.uniform(0.80, 0.99), 2)
        else:
            severity = random.randint(*cat["severity_range"])
            confidence = round(random.uniform(0.55, 0.98), 2)

        return {
            "type": damage_type,
            "severity": severity,
            "severity_label": _get_severity_label(severity),
            "confidence": confidence,
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

        # Get the overall prediction for this frame
        prediction = self.predict(image_b64)

        # Generate detections (bounding boxes) based on the prediction
        detections = []

        if prediction["type"] != "good":
            num_detections = random.randint(self.min_detections, self.max_detections)

            for _ in range(num_detections):
                cat = DAMAGE_CATEGORIES[prediction["type"]]
                det_confidence = round(random.uniform(0.55, 0.98), 2)
                det_severity = random.randint(*cat["severity_range"])

                # Random bounding box
                box_w = random.randint(int(width * 0.05), int(width * 0.25))
                box_h = random.randint(int(height * 0.05), int(height * 0.25))
                x1 = random.randint(0, max(0, width - box_w))
                y1 = random.randint(0, max(0, height - box_h))
                x2 = x1 + box_w
                y2 = y1 + box_h

                detections.append({
                    "id": str(uuid.uuid4())[:8],
                    "label": prediction["type"],
                    "confidence": det_confidence,
                    "severity": det_severity,
                    "severity_label": _get_severity_label(det_severity),
                    "color": cat["color"],
                    "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                    "area_px": box_w * box_h,
                })

        # Annotate the image with bounding boxes
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
        pred_type = prediction["type"].upper()
        pred_severity = prediction["severity"]
        pred_color = DAMAGE_CATEGORIES[prediction["type"]]["color"]
        banner_text = f"  {pred_type}  |  Severity: {pred_severity}/10 ({prediction['severity_label']})  "

        text_bbox = draw.textbbox((0, 0), banner_text, font=font_large)
        text_w = text_bbox[2] - text_bbox[0]
        text_h = text_bbox[3] - text_bbox[1]
        banner_h = text_h + 16

        # Semi-transparent banner background
        overlay = Image.new("RGBA", annotated.size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.rectangle([0, 0, annotated.width, banner_h], fill=(0, 0, 0, 180))
        annotated = Image.alpha_composite(annotated.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(annotated)

        draw.text((10, 8), banner_text, fill=pred_color, font=font_large)

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
            "severity": prediction["severity"],
            "severity_label": prediction["severity_label"],
            "total_detections": len(detections),
            "damage_types": damage_counts,
            "max_severity": max_severity,
            "max_severity_label": _get_severity_label(max_severity),
        }
