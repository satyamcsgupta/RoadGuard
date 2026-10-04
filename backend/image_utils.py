import tempfile
import warnings
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError


MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024
MAX_IMAGE_PIXELS = 60_000_000
IMAGE_FORMATS = {
    "JPEG": (".jpg", "image/jpeg"),
    "PNG": (".png", "image/png"),
    "WEBP": (".webp", "image/webp"),
    "GIF": (".gif", "image/gif"),
}
UPLOAD_CHUNK_SIZE = 1024 * 1024


def save_validated_image(upload: UploadFile) -> tuple[Path, str, str]:
    temporary_file = tempfile.NamedTemporaryFile(
        prefix="roadguard-upload-",
        suffix=".image",
        delete=False,
    )
    temporary_path = Path(temporary_file.name)
    byte_count = 0
    try:
        with temporary_file:
            while chunk := upload.file.read(UPLOAD_CHUNK_SIZE):
                byte_count += len(chunk)
                if byte_count > MAX_IMAGE_SIZE_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Image exceeds the 20 MB upload limit.",
                    )
                temporary_file.write(chunk)

        if byte_count == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded image is empty.",
            )

        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(temporary_path) as image:
                image_format = image.format
                width, height = image.size
                if image_format not in IMAGE_FORMATS:
                    raise HTTPException(
                        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                        detail="Unsupported image format. Use JPEG, PNG, WEBP, or GIF.",
                    )
                if width * height > MAX_IMAGE_PIXELS:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail="Image dimensions exceed the supported limit.",
                    )
                image.verify()
        extension, content_type = IMAGE_FORMATS[image_format]
        validated_path = temporary_path.with_suffix(extension)
        temporary_path.replace(validated_path)
        return validated_path, extension, content_type
    except HTTPException:
        temporary_path.unlink(missing_ok=True)
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError,
            Image.DecompressionBombWarning, SyntaxError) as error:
        temporary_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Uploaded file is not a valid supported image.",
        ) from error
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
