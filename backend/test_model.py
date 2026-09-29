from ultralytics import YOLO

model = YOLO("models/best.pt")

print("Model loaded!")
print("Classes:", model.names)

images = [
    "pothole.jpg",
    "pothole2.jpg",
    "pothole3.jpg",
    "pothole4.jpg",
]

for image in images:

    print("\n==============================")
    print("Testing:", image)
    print("==============================")

    results = model.predict(
        source=image,
        conf=0.10,
        imgsz=640,
        save=True
    )

    for result in results:

        if result.boxes is None or len(result.boxes) == 0:
            print("❌ No detections")
            continue

        print("✅ Number of detections:", len(result.boxes))

        for i, box in enumerate(result.boxes):

            class_id = int(box.cls[0])
            confidence = float(box.conf[0])
            coordinates = box.xyxy[0].tolist()

            print(f"\nDetection {i + 1}")
            print("Class ID:", class_id)
            print("Class name:", result.names[class_id])
            print("Confidence:", confidence)
            print("Bounding box:", coordinates)

print("\n========== TEST COMPLETED ==========")