"""
Gemini Vision API Damage Detector — Fallback Processor
-------------------------------------------------------
Drop-in replacement for DamageDetector (ml_processor.py).
Implements the same predict() and process_frame() interfaces.

Uses Gemini Vision to analyse UAV imagery and return:
  - type:           fire | flood | destruction | good
  - severity:       1–10
  - severity_label: human-readable
  - confidence:     0.0–1.0
  - total_area_pct: estimated % of image area affected (0–100)

Enable by setting:
  USE_GEMINI_FALLBACK=1
  GEMINI_API_KEY=<your key>
"""

import base64
import io
import json
import os
import re
import time
import uuid

from PIL import Image, ImageDraw, ImageFont

try:
    from google import genai
    from google.genai import types as genai_types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False

# ─── Shared Constants (mirrors ml_processor.py) ──────────────────────

DAMAGE_CATEGORIES = {
    "fire":        {"color": "#FF4422", "severity_range": (3, 10)},
    "flood":       {"color": "#2288FF", "severity_range": (2, 9)},
    "destruction": {"color": "#FF2266", "severity_range": (5, 10)},
    "good":        {"color": "#44CC66", "severity_range": (1, 1)},
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

GEMINI_MODEL = "gemini-2.5-flash"

ANALYSIS_PROMPT = """You are an expert disaster-response analyst reviewing a UAV aerial image.

You have access to:
1) Visual analysis of the image
2) A trained damage classifier output: ["no_damage", "low", "medium", "high", "severe"]

Your PRIMARY objective is to estimate RISK TO HUMAN LIFE and provide ACTIONABLE guidance for rescue and emergency response teams.

Return ONLY a valid JSON object. No markdown. No explanation.

--------------------------------------------------
CORE PRINCIPLE: LIFE-SAFETY + ACTIONABILITY
--------------------------------------------------

You MUST:
- Infer human risk probabilistically (no need to see people)
- Identify operational challenges (access, terrain, hazards)
- Provide realistic, implementable rescue guidance

Avoid abstract observations. Focus on decisions responders can act on.

--------------------------------------------------
TYPE CLASSIFICATION
--------------------------------------------------

"type" must be ONE of:

- "fire"
- "flood"
- "landslide"
- "storm_damage"
- "earthquake_damage"
- "explosion"
- "industrial_damage"
- "coastal_damage"
- "infrastructure_damage"
- "destruction"
- "good"

--------------------------------------------------
SEVERITY (1–10) — HUMAN RISK BASED
--------------------------------------------------

Severity reflects probability × impact on human life.

Use model output as baseline, then adjust based on:
- Likelihood of human presence
- Damage to residential structures
- Accessibility constraints
- Hazard proximity

--------------------------------------------------
DAMAGE PERCENTAGE
--------------------------------------------------

Estimate % of visible area physically affected.

--------------------------------------------------
CONFIDENCE (0.0–1.0)
--------------------------------------------------

Based on clarity, evidence strength, and model signal.

--------------------------------------------------
CONTEXTUAL FACTORS
--------------------------------------------------

{
  "area_type": "urban | semi-urban | rural | coastal | industrial | unknown",
  "human_presence_probability": "high | medium | low",
  "infrastructure_impact": "none | minor | moderate | major",
  "accessibility": "open | partially_blocked | blocked | unknown",
  "spread": "localized | moderate | widespread"
}

--------------------------------------------------
RESCUE PRIORITY
--------------------------------------------------

- "critical" → immediate life threat + poor access
- "high" → strong likelihood of affected population
- "medium" → moderate or uncertain impact
- "low" → minimal human risk

--------------------------------------------------
ACTIONABLE INSIGHTS (CRITICAL SECTION)
--------------------------------------------------

Generate 3–5 insights that MUST include:

1) TRANSPORT / ACCESS STRATEGY
- Road usability
- Suggested access routes or alternatives (e.g., foot, air, water)

2) IMMEDIATE ACTIONS
- Evacuation, fire containment, flood response, debris clearance

3) RISK PREDICTIONS
- Likely worsening (fire spread, water rise, collapse risk)

4) RESOURCE PRIORITIZATION
- Where responders should focus first

Each insight must:
- Be specific and actionable
- Be grounded in visible evidence
- Avoid vague statements

--------------------------------------------------
RESPONSE STRATEGY (HIGH-LEVEL PLAN)
--------------------------------------------------

Provide a short structured plan:

{
  "primary_objective": "string",
  "recommended_actions": [
    "action 1",
    "action 2"
  ],
  "deployment_suggestions": [
    "resource or team allocation suggestion"
  ]
}

--------------------------------------------------
STRICT JSON SCHEMA
--------------------------------------------------

{
  "type": "string",
  "severity": "integer (1-10)",
  "damage_percentage": "number (0-100)",
  "confidence": "number (0.0-1.0)",
  "rescue_priority": "string (low | medium | high | critical)",
  "contextual_factors": {
    "area_type": "string",
    "human_presence_probability": "string",
    "infrastructure_impact": "string",
    "accessibility": "string",
    "spread": "string"
  },
  "actionable_insights": [
    "string insight 1",
    "string insight 2",
    "string insight 3"
  ],
  "response_strategy": {
    "primary_objective": "string",
    "recommended_actions": [
      "string"
    ],
    "deployment_suggestions": [
      "string"
    ]
  },
  "reasoning": "string (ONE sentence combining visual evidence + inferred human risk)"
}

--------------------------------------------------
STRICT RULES
--------------------------------------------------

- OUTPUT ONLY JSON
- DO NOT add/remove fields
- actionable_insights must be 3–5 items
- Each insight must include action, not just observation
- Strategy must be realistic and grounded in visible evidence
- Do NOT hallucinate unseen infrastructure
- reasoning must be exactly one sentence
"""


def _get_severity_label(severity: int) -> str:
    return SEVERITY_LABELS.get(int(severity), "Unknown")


def _clamp(value, lo, hi):
    return max(lo, min(hi, value))


class GeminiDamageDetector:
    """
    Gemini Vision API damage detector.
    Implements the same interface as DamageDetector in ml_processor.py.
    """

    def __init__(self):
        if not GENAI_AVAILABLE:
            raise RuntimeError(
                "google-genai is not installed. Run: pip install google-genai"
            )
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GEMINI_API_KEY environment variable is not set."
            )
        self.client = genai.Client(api_key=api_key)
        self.frame_count = 0
        print(f"[Gemini] Initialised with model: {GEMINI_MODEL}")

    # ─── Single Image Prediction (Simple API) ────────────────────────

    def predict(self, image_b64: str) -> dict:
        """
        Predict damage type, severity, confidence, and area for a single image.

        Returns:
            dict with keys:
                - type:           "fire" | "flood" | "destruction" | "good"
                - severity:       int 1–10
                - severity_label: human-readable severity
                - confidence:     float 0.0–1.0
                - total_area_pct: float 0–100 (% of image area affected)
        """
        raw = self._call_gemini(image_b64)
        return self._parse_prediction(raw)

    # ─── Full Frame Processing (for WebSocket streaming) ─────────────

    def process_frame(self, image_b64: str) -> dict:
        """
        Process a base64-encoded image and return annotated image + detections.
        Mirrors DamageDetector.process_frame() exactly.
        """
        start_time = time.time()
        self.frame_count += 1

        # Decode the incoming image
        image_data = base64.b64decode(image_b64)
        image = Image.open(io.BytesIO(image_data)).convert("RGB")
        width, height = image.size

        # Get Gemini prediction
        prediction = self.predict(image_b64)

        # Build detections list (single detection covering the estimated area)
        detections = []
        if prediction["type"] != "good":
            area_pct = prediction.get("total_area_pct", 20.0) / 100.0
            cat = DAMAGE_CATEGORIES[prediction["type"]]

            # Estimate a bounding box from the area percentage
            import math
            side_ratio = math.sqrt(area_pct)
            box_w = int(width * _clamp(side_ratio, 0.05, 0.95))
            box_h = int(height * _clamp(side_ratio, 0.05, 0.95))
            x1 = (width - box_w) // 2
            y1 = (height - box_h) // 2
            x2 = x1 + box_w
            y2 = y1 + box_h

            detections.append({
                "id": str(uuid.uuid4())[:8],
                "label": prediction["type"],
                "confidence": prediction["confidence"],
                "severity": prediction["severity"],
                "severity_label": prediction["severity_label"],
                "color": cat["color"],
                "bbox": {"x1": x1, "y1": y1, "x2": x2, "y2": y2},
                "area_px": box_w * box_h,
                "total_area_pct": prediction.get("total_area_pct", 0.0),
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

    # ─── Gemini API Call ─────────────────────────────────────────────

    def _call_gemini(self, image_b64: str) -> dict | None:
        """Send image to Gemini Vision and return raw parsed JSON or None."""
        try:
            image_bytes = base64.b64decode(image_b64)

            # Detect MIME type
            mime_type = "image/jpeg"
            if image_bytes[:8] == b"\x89PNG\r\n\x1a\n":
                mime_type = "image/png"

            response = self.client.models.generate_content(
                model=GEMINI_MODEL,
                contents=[
                    genai_types.Part.from_bytes(
                        data=image_bytes,
                        mime_type=mime_type,
                    ),
                    ANALYSIS_PROMPT,
                ],
            )

            text = response.text.strip()
            # Strip markdown code fences if Gemini wraps output
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)

            return json.loads(text)

        except json.JSONDecodeError as e:
            print(f"[Gemini] JSON parse error: {e} | raw: {response.text!r}")
            return None
        except Exception as e:
            print(f"[Gemini] API error: {e}")
            return None

    def _parse_prediction(self, raw: dict | None) -> dict:
        """Validate and normalise the Gemini JSON response into a prediction dict."""
        VALID_TYPES = set(DAMAGE_CATEGORIES.keys())

        if not raw or not isinstance(raw, dict):
            # Safe fallback on any API failure
            print("[Gemini] Using safe fallback prediction (API/parse failure)")
            return {
                "type": "good",
                "severity": 1,
                "severity_label": "None",
                "confidence": 0.0,
                "total_area_pct": 0.0,
            }

        damage_type = raw.get("type", "good")
        if damage_type not in VALID_TYPES:
            damage_type = "good"

        severity = int(_clamp(raw.get("severity", 1), 1, 10))
        if damage_type == "good":
            severity = 1

        confidence = float(_clamp(raw.get("confidence", 0.5), 0.0, 1.0))
        total_area_pct = float(_clamp(raw.get("total_area_pct", 0.0), 0.0, 100.0))

        if raw.get("reasoning"):
            print(f"[Gemini] Reasoning: {raw['reasoning']}")

        return {
            "type": damage_type,
            "severity": severity,
            "severity_label": _get_severity_label(severity),
            "confidence": round(confidence, 2),
            "total_area_pct": round(total_area_pct, 1),
        }

    # ─── Image Annotation (mirrors ml_processor.py) ──────────────────

    def _annotate_image(
        self, image: Image.Image, detections: list, prediction: dict
    ) -> Image.Image:
        """Draw bounding boxes, labels, and overall prediction on the image."""
        annotated = image.copy()
        draw = ImageDraw.Draw(annotated)

        # Font loading (same fallback chain as ml_processor.py)
        try:
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 14)
            font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 11)
            font_large = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
        except (OSError, IOError):
            try:
                font = ImageFont.truetype(
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14
                )
                font_small = ImageFont.truetype(
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 11
                )
                font_large = ImageFont.truetype(
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18
                )
            except (OSError, IOError):
                font = ImageFont.load_default()
                font_small = font
                font_large = font

        # Banner
        pred_type = prediction["type"].upper()
        pred_severity = prediction["severity"]
        pred_color = DAMAGE_CATEGORIES[prediction["type"]]["color"]
        area_pct = prediction.get("total_area_pct", 0.0)
        banner_text = (
            f"  {pred_type}  |  Severity: {pred_severity}/10 "
            f"({prediction['severity_label']})  |  Area: {area_pct:.1f}%  "
        )

        text_bbox = draw.textbbox((0, 0), banner_text, font=font_large)
        text_h = text_bbox[3] - text_bbox[1]
        banner_h = text_h + 16

        overlay = Image.new("RGBA", annotated.size, (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        overlay_draw.rectangle(
            [0, 0, annotated.width, banner_h], fill=(0, 0, 0, 180)
        )
        annotated = Image.alpha_composite(
            annotated.convert("RGBA"), overlay
        ).convert("RGB")
        draw = ImageDraw.Draw(annotated)
        draw.text((10, 8), banner_text, fill=pred_color, font=font_large)

        # Gemini source tag (bottom-right corner)
        tag = "⚡ Gemini Vision"
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

        # Bounding boxes
        for det in detections:
            bbox = det["bbox"]
            color = det["color"]
            label = det["label"]
            confidence = det["confidence"]
            severity_label = det["severity_label"]
            severity = det["severity"]
            det_area = det.get("total_area_pct", 0.0)

            x1, y1, x2, y2 = bbox["x1"], bbox["y1"], bbox["x2"], bbox["y2"]

            for i in range(3):
                draw.rectangle(
                    [x1 - i, y1 - i, x2 + i, y2 + i], outline=color
                )

            label_text = f"{label} {confidence:.0%}"
            severity_text = f"[Severity: {severity}/10 — {severity_label}] Area: {det_area:.1f}%"

            text_bbox = draw.textbbox((0, 0), label_text, font=font)
            text_w = text_bbox[2] - text_bbox[0]
            text_h = text_bbox[3] - text_bbox[1]

            sev_bbox = draw.textbbox((0, 0), severity_text, font=font_small)
            sev_w = sev_bbox[2] - sev_bbox[0]

            total_w = max(text_w, sev_w) + 12
            total_h = text_h + 20

            draw.rectangle(
                [x1, y1 - total_h - 4, x1 + total_w, y1], fill=color
            )
            draw.text(
                (x1 + 4, y1 - total_h - 2), label_text, fill="white", font=font
            )
            draw.text(
                (x1 + 4, y1 - 16), severity_text, fill="white", font=font_small
            )

            marker_len = min(15, (x2 - x1) // 4)
            for corner_x, corner_y, dx, dy in [
                (x1, y1, 1, 1),
                (x2, y1, -1, 1),
                (x1, y2, 1, -1),
                (x2, y2, -1, -1),
            ]:
                draw.line(
                    [(corner_x, corner_y), (corner_x + dx * marker_len, corner_y)],
                    fill=color,
                    width=3,
                )
                draw.line(
                    [(corner_x, corner_y), (corner_x, corner_y + dy * marker_len)],
                    fill=color,
                    width=3,
                )

        return annotated

    # ─── Summary (mirrors ml_processor.py + adds area field) ─────────

    def _generate_summary(self, detections: list, prediction: dict) -> dict:
        """Generate a summary of all detections."""
        if prediction["type"] == "good":
            return {
                "status": "good",
                "type": "good",
                "severity": 1,
                "severity_label": "None",
                "total_area_pct": 0.0,
                "message": "No damage detected — area looks good",
            }

        damage_counts: dict = {}
        max_severity = 0
        total_area = prediction.get("total_area_pct", 0.0)
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
            "total_area_pct": total_area,
        }
