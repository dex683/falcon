from index import _make_detector
import os
print("Current Key:", os.environ.get("GEMINI_API_KEY"))
detector, name, ok = _make_detector(True)
print(name, ok)
