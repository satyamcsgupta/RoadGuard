import os
from pathlib import Path
from urllib.parse import quote

import httpx

from config import load_backend_env

BACKEND_DIR = Path(__file__).resolve().parent
LOCAL_REPORT_IMAGES_DIR = BACKEND_DIR / "uploads" / "reports"

load_backend_env()

STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").strip().lower()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "").strip()


class StorageError(Exception):
    pass


class StorageNotFound(StorageError):
    pass


class InvalidStorageKey(StorageNotFound):
    pass


# ---------------------------------------------------------
# Configuration validation
# ---------------------------------------------------------

if STORAGE_BACKEND not in {"local", "supabase"}:
    raise RuntimeError(
        "STORAGE_BACKEND must be either 'local' or 'supabase'."
    )


if STORAGE_BACKEND == "supabase":
    if not SUPABASE_URL:
        raise RuntimeError(
            "Supabase storage requires SUPABASE_URL."
        )

    if not SUPABASE_URL.startswith(("http://", "https://")):
        raise RuntimeError(
            "SUPABASE_URL must start with http:// or https://."
        )
    supabase_url = httpx.URL(SUPABASE_URL)
    if not supabase_url.host:
        raise RuntimeError(
            "SUPABASE_URL must include a valid hostname."
        )

    if not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError(
            "Supabase storage requires SUPABASE_SERVICE_ROLE_KEY."
        )

    if not SUPABASE_STORAGE_BUCKET:
        raise RuntimeError(
            "Supabase storage requires SUPABASE_STORAGE_BUCKET."
        )


# ---------------------------------------------------------
# Storage key validation
# ---------------------------------------------------------

def _validate_storage_key(storage_key: str) -> str:
    if (
        not storage_key
        or storage_key.startswith("/")
        or "\\" in storage_key
        or any(
            part in {"", ".", ".."}
            for part in storage_key.split("/")
        )
    ):
        raise InvalidStorageKey(
            "Invalid report image storage key."
        )

    return storage_key


# ---------------------------------------------------------
# Local storage helpers
# ---------------------------------------------------------

def _local_image_path(storage_key: str) -> Path:
    key = _validate_storage_key(storage_key)

    path = (
        LOCAL_REPORT_IMAGES_DIR / key
    ).resolve()

    if not path.is_relative_to(
        LOCAL_REPORT_IMAGES_DIR.resolve()
    ):
        raise InvalidStorageKey(
            "Invalid report image storage key."
        )

    return path


# ---------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------

def _supabase_headers(
    content_type: str | None = None,
) -> dict[str, str]:

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": (
            f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"
        ),
    }

    if content_type:
        headers["Content-Type"] = content_type

    return headers


def _supabase_object_url(
    storage_key: str,
) -> str:

    key = _validate_storage_key(storage_key)

    bucket = quote(
        SUPABASE_STORAGE_BUCKET,
        safe="",
    )

    path = quote(
        key,
        safe="/",
    )

    return (
        f"{SUPABASE_URL}"
        f"/storage/v1/object/"
        f"{bucket}/{path}"
    )


# ---------------------------------------------------------
# Upload report image
# ---------------------------------------------------------

def upload_report_image(
    source_path: Path,
    storage_key: str,
    content_type: str,
) -> None:

    key = _validate_storage_key(storage_key)

    # -----------------------------
    # LOCAL STORAGE
    # -----------------------------

    if STORAGE_BACKEND == "local":

        destination = _local_image_path(key)

        destination.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        created = False

        try:

            with source_path.open("rb") as source:
                with destination.open("xb") as target:

                    created = True

                    while chunk := source.read(
                        1024 * 1024
                    ):
                        target.write(chunk)

        except Exception:

            if created:
                destination.unlink(
                    missing_ok=True
                )

            raise

        return

    # -----------------------------
    # SUPABASE STORAGE
    # -----------------------------

    try:

        with source_path.open("rb") as source:

            def image_chunks():

                while chunk := source.read(
                    1024 * 1024
                ):
                    yield chunk

            response = httpx.post(
                _supabase_object_url(key),

                headers={
                    **_supabase_headers(
                        content_type
                    ),

                    "Content-Length": str(
                        source_path.stat().st_size
                    ),

                    "x-upsert": "false",
                },

                content=image_chunks(),

                timeout=60,
            )

    except httpx.HTTPError as error:
        error_detail = str(error).replace(
            SUPABASE_SERVICE_ROLE_KEY,
            "[REDACTED]",
        )

        raise StorageError(
            "Unable to upload report image "
            f"to storage ({type(error).__name__}: {error_detail})."
        ) from error

    if not response.is_success:
        error_detail = response.text[:500].replace(
            SUPABASE_SERVICE_ROLE_KEY,
            "[REDACTED]",
        )

        raise StorageError(
            "Unable to upload report image "
            f"to storage "
            f"(HTTP {response.status_code}): {error_detail}"
        )


# ---------------------------------------------------------
# Get report image
# ---------------------------------------------------------

def get_report_image(
    storage_key: str,
) -> Path | str:

    key = _validate_storage_key(
        storage_key
    )

    # -----------------------------
    # LOCAL STORAGE
    # -----------------------------

    if STORAGE_BACKEND == "local":

        path = _local_image_path(key)

        if not path.is_file():

            raise StorageNotFound(
                "Report image not found."
            )

        return path

    # -----------------------------
    # SUPABASE STORAGE
    # -----------------------------

    encoded_bucket = quote(
        SUPABASE_STORAGE_BUCKET,
        safe="",
    )

    encoded_key = quote(
        key,
        safe="/",
    )

    sign_url = (
        f"{SUPABASE_URL}"
        f"/storage/v1/object/sign/"
        f"{encoded_bucket}/{encoded_key}"
    )

    try:

        response = httpx.post(
            sign_url,

            headers=_supabase_headers(
                "application/json"
            ),

            json={
                "expiresIn": 60
            },

            timeout=15,
        )

    except httpx.HTTPError as error:

        raise StorageError(
            "Unable to retrieve report image "
            "from storage."
        ) from error

    if response.status_code == 404:

        raise StorageNotFound(
            "Report image not found."
        )

    if not response.is_success:

        raise StorageError(
            "Unable to retrieve report image "
            f"from storage "
            f"(HTTP {response.status_code})."
        )

    try:

        signed_url = response.json()[
            "signedURL"
        ]

    except (
        ValueError,
        KeyError,
        TypeError,
    ) as error:

        raise StorageError(
            "Storage returned an invalid "
            "signed image URL."
        ) from error

    if (
        not isinstance(
            signed_url,
            str,
        )
        or not signed_url
    ):

        raise StorageError(
            "Storage returned an invalid "
            "signed image URL."
        )

    # Supabase can sometimes return
    # a relative signed URL.

    if signed_url.startswith("/"):

        return (
            f"{SUPABASE_URL}"
            f"/storage/v1"
            f"{signed_url}"
        )

    return signed_url


# ---------------------------------------------------------
# Check whether report image exists
# ---------------------------------------------------------

def report_image_exists(
    storage_key: str,
) -> bool:

    if STORAGE_BACKEND == "supabase":

        _validate_storage_key(
            storage_key
        )

        # Supabase existence is checked
        # when the image is requested.

        return True

    return _local_image_path(
        storage_key
    ).is_file()


# ---------------------------------------------------------
# Delete report image
# ---------------------------------------------------------

def delete_report_image(
    storage_key: str,
) -> None:

    key = _validate_storage_key(
        storage_key
    )

    # -----------------------------
    # LOCAL STORAGE
    # -----------------------------

    if STORAGE_BACKEND == "local":

        _local_image_path(
            key
        ).unlink(
            missing_ok=True
        )

        return

    # -----------------------------
    # SUPABASE STORAGE
    # -----------------------------

    try:

        # IMPORTANT:
        # Use httpx.request() instead of
        # httpx.delete() because the installed
        # httpx version does not accept
        # json= with httpx.delete().

        response = httpx.request(
            "DELETE",

            (
                f"{SUPABASE_URL}"
                f"/storage/v1/object/"
                f"{quote(SUPABASE_STORAGE_BUCKET, safe='')}"
            ),

            headers=_supabase_headers(
                "application/json"
            ),

            json={
                "prefixes": [key]
            },

            timeout=15,
        )

    except httpx.HTTPError as error:

        raise StorageError(
            "Unable to delete report image "
            "from storage."
        ) from error

    if not response.is_success:

        raise StorageError(
            "Unable to delete report image "
            f"from storage "
            f"(HTTP {response.status_code})."
        )