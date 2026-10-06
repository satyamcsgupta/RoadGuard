import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

os.environ["DATABASE_URL"] = "sqlite://"
os.environ.setdefault("STORAGE_BACKEND", "local")

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy import text
from unittest.mock import Mock

import main
import storage
from database import Base, DATABASE_URL, initialize_database, normalize_database_url
from models import User
from security import password_context
from storage import LOCAL_REPORT_IMAGES_DIR, upload_report_image


def image_bytes() -> bytes:
    image = Image.new("RGB", (32, 32), color=(20, 120, 60))
    result = io.BytesIO()
    image.save(result, format="JPEG")
    return result.getvalue()


class BackendPreparationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=cls.engine)
        cls.session_factory = sessionmaker(bind=cls.engine, autoflush=False)

        def override_get_db():
            db = cls.session_factory()
            try:
                yield db
            finally:
                db.close()

        main.app.dependency_overrides[main.get_db] = override_get_db
        cls.client_context = TestClient(main.app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)
        main.app.dependency_overrides.clear()
        cls.engine.dispose()

    def login(self, email: str, password: str = "password-123") -> str:
        response = self.client.post(
            "/login",
            json={"email": email, "password": password},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["access_token"]

    def report_payload(self, token: str, filename: str = "scan.jpg"):
        return self.client.post(
            "/reports",
            headers={"Authorization": f"Bearer {token}"},
            data={
                "image_filename": filename,
                "latitude": "19.076",
                "longitude": "72.8777",
                "pothole_count": "1",
                "description": "Pothole near the crossing",
            },
            files={"file": (filename, image_bytes(), "image/jpeg")},
        )

    def test_api_workflows_and_security(self):
        self.assertEqual(DATABASE_URL, "sqlite://")
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})
        self.assertEqual(
            self.client.post(
                "/analyze",
                files={"file": ("road.jpg", image_bytes(), "image/jpeg")},
            ).status_code,
            401,
        )

        registered = self.client.post(
            "/register",
            json={
                "name": "Road User",
                "email": "road-user@example.test",
                "password": "password-123",
            },
        )
        self.assertEqual(registered.status_code, 201, registered.text)
        user_token = self.login("road-user@example.test")
        user_headers = {"Authorization": f"Bearer {user_token}"}

        self.assertEqual(
            self.client.get("/admin/dashboard", headers=user_headers).status_code,
            403,
        )

        invalid_coordinates = self.client.post(
            "/reports",
            headers=user_headers,
            data={
                "image_filename": "scan.jpg",
                "latitude": "91",
                "longitude": "72",
                "pothole_count": "1",
            },
            files={"file": ("scan.jpg", image_bytes(), "image/jpeg")},
        )
        self.assertEqual(invalid_coordinates.status_code, 422)

        invalid_image = self.client.post(
            "/analyze",
            headers=user_headers,
            files={"file": ("not-an-image.jpg", b"not an image", "image/jpeg")},
        )
        self.assertEqual(invalid_image.status_code, 415)

        analysis_temp_paths = []

        def fake_predict(source, **kwargs):
            analysis_temp_paths.append(Path(source))
            return [SimpleNamespace(boxes=None)]

        with patch.object(
            main,
            "get_model",
            return_value=SimpleNamespace(predict=fake_predict),
        ):
            analysis_responses = [
                self.client.post(
                    "/analyze",
                    headers=user_headers,
                    files={
                        "file": (
                            "road.bin",
                            image_bytes(),
                            "application/octet-stream",
                        )
                    },
                    data={"latitude": "19.076", "longitude": "72.8777"},
                )
                for _ in range(2)
            ]
        for analysis in analysis_responses:
            self.assertEqual(analysis.status_code, 200, analysis.text)
            self.assertEqual(analysis.json()["potholes_detected"], 0)
            self.assertEqual(analysis.json()["location"]["latitude"], 19.076)
        self.assertNotEqual(analysis_temp_paths[0], analysis_temp_paths[1])
        self.assertTrue(all(path.suffix == ".jpg" for path in analysis_temp_paths))
        self.assertTrue(all(not path.exists() for path in analysis_temp_paths))

        created = self.report_payload(user_token, "extension-does-not-match.png")
        self.assertEqual(created.status_code, 201, created.text)
        report = created.json()["report"]
        self.assertTrue(report["image_filename"].endswith(".jpg"))
        report_id = report["id"]

        self.assertEqual(self.client.get("/reports", headers=user_headers).status_code, 200)
        self.assertEqual(
            self.client.get(f"/reports/{report_id}", headers=user_headers).status_code,
            200,
        )
        image_response = self.client.get(
            f"/reports/{report_id}/image",
            headers=user_headers,
        )
        self.assertEqual(image_response.status_code, 200)
        self.assertTrue(image_response.headers["content-type"].startswith("image/"))

        other_user = self.client.post(
            "/register",
            json={
                "name": "Other User",
                "email": "other-user@example.test",
                "password": "password-123",
            },
        )
        self.assertEqual(other_user.status_code, 201, other_user.text)
        other_token = self.login("other-user@example.test")
        other_headers = {"Authorization": f"Bearer {other_token}"}
        self.assertEqual(
            self.client.get(
                f"/reports/{report_id}/image",
                headers=other_headers,
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.delete(f"/reports/{report_id}", headers=other_headers).status_code,
            403,
        )

        with self.session_factory() as db:
            admin = User(
                name="Road Admin",
                email="road-admin@example.test",
                password_hash=password_context.hash("password-123"),
                role="admin",
            )
            db.add(admin)
            db.commit()
        admin_token = self.login("road-admin@example.test")
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        self.assertEqual(
            self.client.get("/admin/dashboard", headers=admin_headers).status_code,
            200,
        )
        self.assertEqual(
            self.client.get("/admin/reports", headers=admin_headers).status_code,
            200,
        )
        admin_users = self.client.get("/admin/users", headers=admin_headers)
        self.assertEqual(admin_users.status_code, 200, admin_users.text)
        self.assertTrue(
            self.client.get(
                f"/admin/users/{registered.json()['user']['id']}",
                headers=admin_headers,
            ).json()["report_count"]
            >= 1
        )
        admin_image = self.client.get(
            f"/admin/reports/{report_id}/image",
            headers=admin_headers,
        )
        self.assertEqual(admin_image.status_code, 200)
        status_update = self.client.patch(
            f"/admin/reports/{report_id}/status",
            headers=admin_headers,
            json={"status": "under_review", "admin_note": "Inspection scheduled"},
        )
        self.assertEqual(status_update.status_code, 200, status_update.text)
        self.assertEqual(status_update.json()["status"], "under_review")

        image_path = LOCAL_REPORT_IMAGES_DIR / report["image_filename"]
        self.assertTrue(image_path.is_file())
        with tempfile.TemporaryDirectory() as temporary_directory:
            duplicate_source = Path(temporary_directory) / "duplicate.jpg"
            duplicate_source.write_bytes(image_bytes())
            with self.assertRaises(FileExistsError):
                upload_report_image(
                    duplicate_source,
                    report["image_filename"],
                    "image/jpeg",
                )
        self.assertTrue(image_path.is_file())
        deleted = self.client.delete(
            f"/admin/reports/{report_id}",
            headers=admin_headers,
        )
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertFalse(image_path.exists())
        self.assertEqual(
            self.client.get(
                f"/reports/{report_id}",
                headers=user_headers,
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.get(
                f"/reports/{report_id}/image",
                headers=user_headers,
            ).status_code,
            404,
        )

        second_report = self.report_payload(user_token, "second.jpg")
        self.assertEqual(second_report.status_code, 201, second_report.text)
        second_report_data = second_report.json()["report"]
        second_image_path = LOCAL_REPORT_IMAGES_DIR / second_report_data["image_filename"]
        user_deleted = self.client.delete(
            f"/reports/{second_report_data['id']}",
            headers=user_headers,
        )
        self.assertEqual(user_deleted.status_code, 200, user_deleted.text)
        self.assertFalse(second_image_path.exists())

    def test_postgresql_url_normalization_and_driver(self):
        normalized = normalize_database_url(
            "postgres://user:pass@example.test:5432/roadguard"
        )
        self.assertEqual(
            normalized,
            "postgresql+psycopg://user:pass@example.test:5432/roadguard",
        )
        postgres_engine = create_engine(normalized, pool_pre_ping=True)
        try:
            self.assertEqual(postgres_engine.dialect.name, "postgresql")
            self.assertIn("psycopg", postgres_engine.dialect.driver)
        finally:
            postgres_engine.dispose()

    def test_safe_legacy_sqlite_migration_preserves_existing_values(self):
        legacy_engine = create_engine("sqlite://", poolclass=StaticPool)
        try:
            with legacy_engine.begin() as connection:
                connection.execute(
                    text(
                        "CREATE TABLE users ("
                        "id INTEGER PRIMARY KEY, name VARCHAR, email VARCHAR, "
                        "password_hash VARCHAR, role VARCHAR, created_at DATETIME)"
                    )
                )
                connection.execute(
                    text(
                        "CREATE TABLE reports ("
                        "id INTEGER PRIMARY KEY, user_id INTEGER, image_filename VARCHAR, "
                        "latitude FLOAT, longitude FLOAT, pothole_count INTEGER, "
                        "status VARCHAR, created_at DATETIME)"
                    )
                )
                connection.execute(
                    text(
                        "INSERT INTO reports "
                        "(id, user_id, image_filename, latitude, longitude, "
                        "pothole_count, status, created_at) "
                        "VALUES (1, 1, 'old.jpg', 19, 72, 1, 'pending', "
                        "'2019-02-03 04:05:06')"
                    )
                )

            initialize_database(legacy_engine)
            with legacy_engine.connect() as connection:
                report = connection.execute(
                    text("SELECT status, created_at, description, admin_note FROM reports")
                ).one()
            self.assertEqual(report.status, "pending")
            self.assertEqual(report.created_at, "2019-02-03 04:05:06")
            self.assertIsNone(report.description)
            self.assertIsNone(report.admin_note)
        finally:
            legacy_engine.dispose()

    def test_supabase_storage_calls_are_backend_only_and_signed(self):
        service_role_key = "test-only-service-role-key"
        storage_key = "unique-report-image.jpg"
        signed_path = "/object/sign/roadguard-reports/unique-report-image.jpg?token=temp"
        with tempfile.TemporaryDirectory() as temporary_directory:
            source_path = Path(temporary_directory) / "upload.jpg"
            source_path.write_bytes(image_bytes())
            with patch.multiple(
                storage,
                STORAGE_BACKEND="supabase",
                SUPABASE_URL="https://storage.example.test",
                SUPABASE_SERVICE_ROLE_KEY=service_role_key,
                SUPABASE_STORAGE_BUCKET="roadguard-reports",
            ), patch.object(storage.httpx, "post") as post_request, patch.object(
                storage.httpx, "request"
            ) as delete_request:
                response = Mock(is_success=True, status_code=200)
                response.json.return_value = {"signedURL": signed_path}
                post_request.return_value = response
                delete_request.return_value = response

                storage.upload_report_image(source_path, storage_key, "image/jpeg")
                upload_args = post_request.call_args
                self.assertTrue(upload_args.args[0].endswith(storage_key))
                self.assertEqual(
                    upload_args.kwargs["headers"]["Authorization"],
                    f"Bearer {service_role_key}",
                )

                signed_url = storage.get_report_image(storage_key)
                self.assertEqual(
                    signed_url,
                    f"https://storage.example.test/storage/v1{signed_path}",
                )
                storage.delete_report_image(storage_key)
                self.assertEqual(
                    delete_request.call_args.args[0],
                    "DELETE",
                )
                self.assertEqual(
                    delete_request.call_args.kwargs["json"],
                    {"prefixes": [storage_key]},
                )

    def test_supabase_upload_error_includes_safe_response_details(self):
        service_role_key = "test-only-service-role-key"
        with tempfile.TemporaryDirectory() as temporary_directory:
            source_path = Path(temporary_directory) / "upload.jpg"
            source_path.write_bytes(image_bytes())
            with patch.multiple(
                storage,
                STORAGE_BACKEND="supabase",
                SUPABASE_URL="https://storage.example.test",
                SUPABASE_SERVICE_ROLE_KEY=service_role_key,
                SUPABASE_STORAGE_BUCKET="roadguard-reports",
            ), patch.object(storage.httpx, "post") as post_request:
                response = Mock(is_success=False, status_code=400)
                response.text = f"Rejected key {service_role_key}: bucket missing"
                post_request.return_value = response

                with self.assertRaises(storage.StorageError) as raised:
                    storage.upload_report_image(
                        source_path,
                        "upload.jpg",
                        "image/jpeg",
                    )

                self.assertIn("HTTP 400", str(raised.exception))
                self.assertIn("bucket missing", str(raised.exception))
                self.assertNotIn(service_role_key, str(raised.exception))


if __name__ == "__main__":
    unittest.main()
