from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field
from jose import ExpiredSignatureError, JWTError, jwt
from sqlalchemy import case, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from ultralytics import YOLO
from datetime import datetime, timedelta, timezone
from pathlib import Path
import math
import logging
import os
import uuid

from database import (
    get_db,
    initialize_database,
)
from datetime_utils import serialize_utc_datetime
from image_utils import save_validated_image
from models import Report, User
from security import password_context
from storage import (
    StorageError,
    StorageNotFound,
    delete_report_image,
    get_report_image as load_report_image,
    report_image_exists,
    upload_report_image,
)

app = FastAPI()
DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:19006",
    "http://127.0.0.1:19006",
]
configured_cors_origins = os.getenv("CORS_ORIGINS")
cors_origins = (
    [origin.strip() for origin in configured_cors_origins.split(",") if origin.strip()]
    if configured_cors_origins is not None
    else DEFAULT_CORS_ORIGINS
)
if "*" in cors_origins:
    raise RuntimeError("CORS_ORIGINS must list explicit origins; wildcard origins are not allowed.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
JWT_ALGORITHM = "HS256"


def load_jwt_secret():
    secret = os.environ.get("JWT_SECRET")
    if not secret:
        env_path = Path(__file__).resolve().with_name(".env")
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                key, separator, value = line.partition("=")
                if separator and key.strip() == "JWT_SECRET":
                    secret = value.strip().strip("\"'")
                    break
        if secret:
            os.environ.setdefault("JWT_SECRET", secret)
    if not secret:
        raise RuntimeError("JWT_SECRET must be set in the environment or backend/.env")
    return secret


JWT_SECRET = load_jwt_secret()
bearer_scheme = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)


@app.on_event("startup")
def initialize_application_database():
    initialize_database()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing authentication token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        logger.warning("JWT authentication failed: bearer credentials missing")
        raise unauthorized

    try:
        claims = jwt.decode(
            credentials.credentials,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
        )
        user_id = int(claims.get("user_id", claims.get("sub")))
    except ExpiredSignatureError:
        logger.warning("JWT verification failed: token expired")
        raise unauthorized
    except JWTError as error:
        logger.warning("JWT verification failed: %s", type(error).__name__)
        raise unauthorized
    except (TypeError, ValueError):
        logger.warning("JWT verification failed: invalid user identifier")
        raise unauthorized

    user = db.get(User, user_id)
    if user is None:
        logger.warning("JWT verified but corresponding user was not found")
        raise unauthorized
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required",
        )
    return current_user


class RegisterRequest(BaseModel):
    name: str = Field(..., min_length=1)
    email: str = Field(..., min_length=1)
    password: str = Field(..., min_length=8)


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class AdminPasswordUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)


class AdminReportStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(
        ...,
        pattern="^(submitted|under_review|resolved|rejected)$",
    )
    admin_note: str | None = None


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


@app.get("/health")
def health_check():
    return {"status": "ok"}


def validate_coordinates(latitude: float, longitude: float) -> None:
    if not math.isfinite(latitude) or not -90 <= latitude <= 90:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Latitude must be a finite number between -90 and 90.",
        )
    if not math.isfinite(longitude) or not -180 <= longitude <= 180:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Longitude must be a finite number between -180 and 180.",
        )


def report_image_response(storage_key: str):
    try:
        image = load_report_image(storage_key)
    except StorageNotFound as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report image not found",
        ) from error
    except StorageError as error:
        logger.error("Unable to retrieve report image: %s", error)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Unable to retrieve report image.",
        ) from error

    if isinstance(image, Path):
        return FileResponse(image)
    return RedirectResponse(image, status_code=status.HTTP_307_TEMPORARY_REDIRECT)


@app.post("/register", status_code=status.HTTP_201_CREATED)
def register_user(payload: RegisterRequest, db: Session = Depends(get_db)):
    name = payload.name.strip()
    email = payload.email.strip().lower()

    if not name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Name must not be empty",
        )
    if not email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
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


@app.post("/login")
def login_user(payload: LoginRequest, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))

    if user is None or not password_context.verify(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = jwt.encode(
        {
            "sub": str(user.id),
            "user_id": user.id,
            "email": user.email,
            "role": user.role,
            "exp": datetime.now(timezone.utc) + timedelta(minutes=60),
        },
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
        },
    }


@app.get("/admin/me")
def get_admin_profile(admin_user: User = Depends(require_admin)):
    return {
        "id": admin_user.id,
        "name": admin_user.name,
        "email": admin_user.email,
        "role": admin_user.role,
    }


@app.patch("/admin/me/password")
def update_admin_password(
    payload: AdminPasswordUpdate,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not password_context.verify(
        payload.current_password, admin_user.password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )

    admin_user.password_hash = password_context.hash(payload.new_password)
    db.commit()
    return {"message": "Password updated successfully"}


@app.get("/admin/dashboard")
def get_admin_dashboard(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    total_reports, submitted_reports, under_review_reports, resolved_reports, rejected_reports = db.execute(
        select(
            func.count(Report.id),
            func.coalesce(
                func.sum(case((Report.status == "submitted", 1), else_=0)),
                0,
            ),
            func.coalesce(
                func.sum(case((Report.status == "under_review", 1), else_=0)),
                0,
            ),
            func.coalesce(
                func.sum(case((Report.status == "resolved", 1), else_=0)),
                0,
            ),
            func.coalesce(
                func.sum(case((Report.status == "rejected", 1), else_=0)),
                0,
            ),
        )
    ).one()
    total_users = db.scalar(
        select(func.count(User.id)).where(User.role == "user")
    ) or 0
    recent_reports = db.scalars(
        select(Report)
        .order_by(Report.created_at.desc(), Report.id.desc())
        .limit(5)
    ).all()

    return {
        "total_reports": total_reports,
        "submitted_reports": submitted_reports,
        "under_review_reports": under_review_reports,
        "resolved_reports": resolved_reports,
        "rejected_reports": rejected_reports,
        "total_users": total_users,
        "recent_reports": [
            {
                "id": report.id,
                "pothole_count": report.pothole_count,
                "latitude": report.latitude,
                "longitude": report.longitude,
                "status": report.status,
                "admin_note": report.admin_note,
                "created_at": serialize_utc_datetime(report.created_at),
            }
            for report in recent_reports
        ],
    }


def serialize_admin_report(report: Report, user: User) -> dict:
    try:
        image_available = report_image_exists(report.image_filename)
    except StorageError:
        image_available = False

    return {
        "id": report.id,
        "user_id": report.user_id,
        "user_name": user.name,
        "user_email": user.email,
        "potholes_detected": report.pothole_count,
        "latitude": report.latitude,
        "longitude": report.longitude,
        "description": report.description,
        "status": report.status,
        "admin_note": report.admin_note,
        "image_filename": report.image_filename,
        "image_available": image_available,
        "created_at": serialize_utc_datetime(report.created_at),
    }


@app.get("/admin/reports")
def get_admin_reports(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    reports_with_users = db.execute(
        select(Report, User)
        .join(User, User.id == Report.user_id)
        .order_by(Report.created_at.desc(), Report.id.desc())
    ).all()
    return [
        serialize_admin_report(report, user)
        for report, user in reports_with_users
    ]


@app.get("/admin/users")
def get_admin_users(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user_report_counts = (
        select(Report.user_id, func.count(Report.id).label("report_count"))
        .group_by(Report.user_id)
        .subquery()
    )
    users_with_counts = db.execute(
        select(
            User.id,
            User.name,
            User.email,
            User.role,
            User.created_at,
            func.coalesce(user_report_counts.c.report_count, 0).label(
                "report_count"
            ),
        )
        .outerjoin(user_report_counts, user_report_counts.c.user_id == User.id)
        .order_by(User.created_at.desc(), User.id.desc())
    ).all()

    return [
        {
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "created_at": serialize_utc_datetime(user.created_at),
            "report_count": user.report_count,
        }
        for user in users_with_counts
    ]


@app.get("/admin/users/{user_id}")
def get_admin_user(
    user_id: int,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    report_count = db.scalar(
        select(func.count(Report.id)).where(Report.user_id == user.id)
    ) or 0
    recent_reports = db.scalars(
        select(Report)
        .where(Report.user_id == user.id)
        .order_by(Report.created_at.desc(), Report.id.desc())
        .limit(5)
    ).all()

    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "created_at": serialize_utc_datetime(user.created_at),
        "report_count": report_count,
        "recent_reports": [
            {
                "id": report.id,
                "potholes_detected": report.pothole_count,
                "latitude": report.latitude,
                "longitude": report.longitude,
                "status": report.status,
                "created_at": serialize_utc_datetime(report.created_at),
            }
            for report in recent_reports
        ],
    }


@app.get("/admin/reports/{report_id}")
def get_admin_report(
    report_id: int,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    report_with_user = db.execute(
        select(Report, User)
        .join(User, User.id == Report.user_id)
        .where(Report.id == report_id)
    ).first()
    if report_with_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )
    report, user = report_with_user
    return serialize_admin_report(report, user)


@app.patch("/admin/reports/{report_id}/status")
def update_admin_report_status(
    report_id: int,
    payload: AdminReportStatusUpdate,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    report_with_user = db.execute(
        select(Report, User)
        .join(User, User.id == Report.user_id)
        .where(Report.id == report_id)
    ).first()
    if report_with_user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )

    report, user = report_with_user
    if "admin_note" in payload.model_fields_set:
        admin_note = (payload.admin_note or "").strip() or None
    else:
        admin_note = report.admin_note
    if payload.status == "rejected" and not admin_note:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A reason is required when rejecting a report.",
        )
    report.status = payload.status
    report.admin_note = admin_note
    db.commit()
    db.refresh(report)
    return serialize_admin_report(report, user)


@app.delete("/admin/reports/{report_id}")
def delete_admin_report(
    report_id: int,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )

    image_filename = report.image_filename
    db.delete(report)
    db.commit()
    try:
        delete_report_image(image_filename)
    except (OSError, StorageError):
        logger.exception("Unable to remove image for admin-deleted report %s", report_id)
    return {"message": f"Report #{report_id} deleted successfully"}


@app.get("/admin/reports/{report_id}/image")
def get_admin_report_image(
    report_id: int,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report image not found",
        )

    return report_image_response(report.image_filename)


def serialize_report(report: Report) -> dict:
    return {
        "id": report.id,
        "user_id": report.user_id,
        "image_filename": report.image_filename,
        "latitude": report.latitude,
        "longitude": report.longitude,
        "pothole_count": report.pothole_count,
        "description": report.description,
        "status": report.status,
        "admin_note": report.admin_note,
        "created_at": serialize_utc_datetime(report.created_at),
    }


@app.post("/reports", status_code=status.HTTP_201_CREATED)
def create_report(
    image_filename: str = Form(...),
    latitude: float = Form(...),
    longitude: float = Form(...),
    pothole_count: int = Form(...),
    file: UploadFile | None = File(None),
    description: str | None = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    validate_coordinates(latitude, longitude)
    if pothole_count <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot create a report without a detected pothole.",
        )

    original_filename = Path(image_filename.strip()).name
    if not original_filename:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Image filename must not be empty",
        )
    normalized_description = description.strip() if description else None

    filename = original_filename
    uploaded_image_key: str | None = None
    if file is not None:
        temporary_path, extension, content_type = save_validated_image(file)
        filename = f"{uuid.uuid4().hex}{extension}"
        try:
            upload_report_image(temporary_path, filename, content_type)
            uploaded_image_key = filename
        except StorageError as error:
            logger.error("Unable to store report image: %s", error)
            try:
                delete_report_image(filename)
            except (OSError, StorageError):
                logger.exception("Unable to clean up an incomplete report image upload")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Unable to store report image.",
            ) from error
        finally:
            temporary_path.unlink(missing_ok=True)

    report = Report(
        user_id=current_user.id,
        image_filename=filename,
        latitude=latitude,
        longitude=longitude,
        pothole_count=pothole_count,
        description=normalized_description,
        status="submitted",
    )
    db.add(report)
    try:
        db.commit()
        db.refresh(report)
    except Exception:
        db.rollback()
        if uploaded_image_key is not None:
            try:
                delete_report_image(uploaded_image_key)
            except (OSError, StorageError):
                logger.exception(
                    "Unable to clean up image after report insertion failed"
                )
        raise
    return {
        "message": "Report created successfully",
        "report": serialize_report(report),
    }


@app.get("/reports")
def get_user_reports(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    reports = db.scalars(
        select(Report)
        .where(Report.user_id == current_user.id)
        .order_by(Report.created_at.desc(), Report.id.desc())
    ).all()
    return [serialize_report(report) for report in reports]


@app.get("/reports/{report_id}")
def get_report(
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    report = db.get(Report, report_id)
    if report is None or report.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )
    return serialize_report(report)


@app.get("/reports/{report_id}/image")
def get_report_image(
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    report = db.get(Report, report_id)
    if report is None or report.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report image not found",
        )

    return report_image_response(report.image_filename)


@app.delete("/reports/{report_id}")
def delete_report(
    report_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    report = db.get(Report, report_id)
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found",
        )
    if current_user.id != report.user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to delete this report",
        )

    image_filename = report.image_filename
    db.delete(report)
    db.commit()
    try:
        delete_report_image(image_filename)
    except (OSError, StorageError):
        logger.exception("Unable to remove image for deleted report %s", report_id)
    return {"message": "Report deleted successfully"}


# ==============================
# Analyze road image
# ==============================

@app.post("/analyze")
async def analyze_image(
    file: UploadFile = File(...),
    latitude: float | None = Form(None),
    longitude: float | None = Form(None),
    current_user: User = Depends(get_current_user),
):
    if latitude is not None and not math.isfinite(latitude):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Latitude must be a finite number between -90 and 90.",
        )
    if longitude is not None and not math.isfinite(longitude):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Longitude must be a finite number between -180 and 180.",
        )
    if (latitude is not None and not -90 <= latitude <= 90) or (
        longitude is not None and not -180 <= longitude <= 180
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Coordinates are outside the valid latitude or longitude range.",
        )
    temp_path, _, _ = save_validated_image(file)
    try:
        results = model.predict(
            source=str(temp_path),
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
            "location": (
                {"latitude": latitude, "longitude": longitude}
                if latitude is not None and longitude is not None
                else None
            )
        }

    finally:
        temp_path.unlink(missing_ok=True)