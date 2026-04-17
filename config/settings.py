from datetime import timedelta
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

# ── django-environ ────────────────────────────────────────────────────────────
env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:5173", "http://127.0.0.1:5173"]),
    CSRF_TRUSTED_ORIGINS=(
        list,
        ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000"],
    ),
    FILE_STORAGE_BACKEND=(str, "local"),
    FILE_SIGNED_URL_TTL=(int, 300),
    UPLOAD_DIR=(str, "uploads"),
    REDIS_URL=(str, "redis://localhost:6379"),
    DATABASE_URL=(str, f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
)

# Read .env file if present (local dev). In production, set vars in the shell.
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env.str("SECRET_KEY")
DEBUG = env.bool("DEBUG")
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS")

INSTALLED_APPS = [
    # daphne must be first so `manage.py runserver` uses ASGI and serves
    # WebSocket routes from config/asgi.py. Without it, runserver falls
    # back to WSGI-only and /ws/ connections fail.
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "channels",
    "config",
    "core.masters",
    "core.tasks",
    "core.worklog",
    "core.notices",
    "core.leads",
    "core.invoices",
    "core.chat",
    "core.holidays",
    "core.settings_app",
    "core.employees",
    "core.attendance",
    "core.growth",
    "core.pace",
    "core.audit",
    "users",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# In dev, WhiteNoise serves the built React `dist/` at :8000 so visiting
# http://localhost:8000 works without running Vite. In prod, nginx handles
# static serving directly, so WhiteNoise is not loaded.
if DEBUG:
    MIDDLEWARE.insert(2, "whitenoise.middleware.WhiteNoiseMiddleware")

ROOT_URLCONF = "config.urls"

WSGI_APPLICATION = "config.wsgi.application"

# ── ASGI / Channels ───────────────────────────────────────────────────────────
ASGI_APPLICATION = "config.asgi.application"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [env.str("REDIS_URL")],
        },
    }
}

DATABASES = {"default": env.db("DATABASE_URL")}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── File storage ──────────────────────────────────────────────────────────────
# "local" = serve uploaded files ourselves via JWT-signed URLs under
#           /api/files/serve (see core/filestore/).
# "s3"    = delegate to the storage backend; FileField.url is expected to be
#           a presigned URL (configure django-storages separately).
FILE_STORAGE_BACKEND = env.str("FILE_STORAGE_BACKEND")
FILE_SIGNED_URL_TTL = env.int("FILE_SIGNED_URL_TTL")  # seconds

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / env.str("UPLOAD_DIR")
FILE_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024  # 20 MB

# When True (prod behind nginx), ServeFileView returns X-Accel-Redirect so
# nginx does the actual file send. When False (dev), Django streams the file
# itself. Only meaningful with FILE_STORAGE_BACKEND=local.
FILESTORE_USE_XACCEL = env.bool("FILESTORE_USE_XACCEL", default=not DEBUG)
FILESTORE_XACCEL_LOCATION = env.str("FILESTORE_XACCEL_LOCATION", default="/protected-uploads/")

# ── Static / React build ──────────────────────────────────────────────────────
# Prod: nginx serves /static/, /assets/, and the built React dist directly
#       (see deploy/nginx.conf.example).
# Dev:  WhiteNoise (loaded only when DEBUG=True) serves the React dist from
#       WHITENOISE_ROOT so http://localhost:8000 works without a separate
#       Vite process. Django's own staticfiles app handles /static/ in DEBUG.
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
FRONTEND_DIR = BASE_DIR / "frontend" / "task-tracker" / "dist"
STATICFILES_DIRS: list[str] = []

if DEBUG:
    WHITENOISE_ROOT = FRONTEND_DIR

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [FRONTEND_DIR],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ── Auth ──────────────────────────────────────────────────────────────────────
AUTH_USER_MODEL = "users.User"

AUTHENTICATION_BACKENDS = ["users.backends.EmailOrUsernameBackend"]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_THROTTLE_CLASSES": ("rest_framework.throttling.ScopedRateThrottle",),
    "DEFAULT_THROTTLE_RATES": {
        "backup": "5/hour",
        "restore": "2/hour",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True

# ── CSRF ──────────────────────────────────────────────────────────────────────
# Django 4+ checks the Origin header against CSRF_TRUSTED_ORIGINS on any form
# POST / admin login / state-changing request. Must include the scheme + host
# (+ port if non-standard). Example: http://49.12.190.43:8000, https://app.example.com
CSRF_TRUSTED_ORIGINS = env.list("CSRF_TRUSTED_ORIGINS")
