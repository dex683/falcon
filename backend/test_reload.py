import requests

print("Turning on Gemini...")
r = requests.post("http://localhost:5001/api/settings", json={"use_gemini": True})
print(r.json())

print("Turning off Gemini...")
r = requests.post("http://localhost:5001/api/settings", json={"use_gemini": False})
print(r.json())

print("Turning on Gemini again...")
r = requests.post("http://localhost:5001/api/settings", json={"use_gemini": True})
print(r.json())
