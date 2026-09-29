from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ultralytics import YOLO
import shutil
import os

from database import get_db
from models import User

app = FastAPI()
password_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=1)
    email: str = Field(..., min_length=1)
    password: str = Field(..., min_length=8)


# ==============================
# Load YOLO model
# ==============================

model = YOLO("models/best.pt")


# ==============================
# Home route
# ==============================

@app.get("/")
def home():
    return {
        "message": "RoadGuard backend is running 🚧"
    }


@app.post("/register", status_code=status.HTTP_201_CREATED)
def register_user(payload: RegisterRequest, db: Session = Depends(get_db)):
    name = payload.name.strip()
    email = payload.email.strip().lower()

    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Name must not be empty",
        )
    if not email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Email must be provided",
        )

    existing_user = db.scalar(select(User).where(User.email == email))
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = User(
        name=name,
        email=email,
        password_hash=password_context.hash(payload.password),
        role="user",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )
    db.refresh(user)

    return {
        "message": "Registration successful",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
        },
    }


# ==============================
# Analyze road image
# ==============================

@app.post("/analyze")
async def analyze_image(
    file: UploadFile = File(...),
    latitude: float = Form(...),
    longitude: float = Form(...)
):

    # Temporary file path
    temp_path = "temp_image.jpg"

    # Save uploaded image
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:

        # Run YOLO detection
        results = model.predict(
            source=temp_path,
            conf=0.10,
            imgsz=640
        )

        result = results[0]

        detections = []

        # Extract detections
        if result.boxes is not None:

            for box in result.boxes:

                class_id = int(box.cls[0])
                confidence = float(box.conf[0])

                coordinates = box.xyxy[0].tolist()

                detections.append({
                    "class_id": class_id,
                    "class_name": "pothole",
                    "confidence": confidence,
                    "bounding_box": {
                        "x1": coordinates[0],
                        "y1": coordinates[1],
                        "x2": coordinates[2],
                        "y2": coordinates[3]
                    }
                })

        return {
            "success": True,
            "filename": file.filename,
            "potholes_detected": len(detections),
            "detections": detections,
            "location": {
                "latitude": latitude,
                "longitude": longitude
            }
        }

    finally:

        # Delete temporary image
        if os.path.exists(temp_path):
            os.remove(temp_path)