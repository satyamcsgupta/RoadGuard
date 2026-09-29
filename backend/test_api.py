import requests
import json

url = "http://127.0.0.1:8000/analyze"

image_path = "pothole2.jpg"

with open(image_path, "rb") as image:
    files = {
        "file": (
            "pothole2.jpg",
            image,
            "image/jpeg"
        )
    }

    data = {
        "latitude": "19.076000",
        "longitude": "72.877700"
    }

    response = requests.post(
        url,
        files=files,
        data=data
    )

print("Status code:", response.status_code)

print("\nResponse:")
print(json.dumps(response.json(), indent=4))