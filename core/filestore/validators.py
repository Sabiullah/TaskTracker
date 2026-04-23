import os
import uuid

from rest_framework.exceptions import ValidationError

DEFAULT_MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20 MB

ALLOWED_DOCUMENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
}

ALLOWED_CHAT_TYPES = ALLOWED_DOCUMENT_TYPES | {
    "application/zip",
    "video/mp4",
    "audio/mpeg",
    "audio/ogg",
}


def validate_upload(file_obj, *, allowed_types=ALLOWED_DOCUMENT_TYPES, max_size=DEFAULT_MAX_UPLOAD_SIZE):
    """Validate size + MIME. Raises DRF ValidationError."""
    if file_obj.size > max_size:
        raise ValidationError({"file": f"File too large (max {max_size // (1024 * 1024)} MB)"})
    content_type = (getattr(file_obj, "content_type", "") or "").lower()
    if content_type and content_type not in allowed_types:
        raise ValidationError({"file": f"Unsupported file type: {content_type}"})


def safe_filename(original_name):
    """Return a randomized filename preserving the original extension."""
    _, ext = os.path.splitext(original_name or "")
    ext = ext.lower()[:10] if ext else ""
    return f"{uuid.uuid4().hex}{ext}"


def _hashed_upload_to(subdir, instance, filename):
    """Shared body for the per-field upload_to helpers below."""
    from django.utils import timezone

    today = timezone.now()
    return f"{subdir.rstrip('/')}/{today:%Y/%m}/{safe_filename(filename)}"


# Module-level ``upload_to`` functions. Django serialises these into
# migrations by import path, so they must be defined at the module level
# (closures from a factory would not deconstruct cleanly).
def employee_address_proof_upload_to(instance, filename):
    return _hashed_upload_to("employees/address_proof", instance, filename)


def chat_upload_to(instance, filename):
    return _hashed_upload_to("chat", instance, filename)


def invoice_upload_to(instance, filename):
    return _hashed_upload_to("invoices", instance, filename)


def conveyance_attachment_upload_to(instance, filename):
    return _hashed_upload_to("conveyance", instance, filename)
