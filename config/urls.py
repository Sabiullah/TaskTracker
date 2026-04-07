from django.conf import settings
from django.contrib import admin
from django.http import Http404, HttpResponse
from django.urls import include, path, re_path
from django.views.static import serve


def serve_index(request):
    index = settings.FRONTEND_DIR / "index.html"
    if not index.exists():
        raise Http404("React app not built yet. Run: npm run build")
    return HttpResponse(index.read_text(encoding="utf-8"), content_type="text/html")


urlpatterns = [
    # Django admin
    path("admin/", admin.site.urls),
    # REST API
    path("api/", include("core.urls")),
    path("api/", include("users.urls")),
    # Vite build assets
    re_path(
        r"^assets/(?P<path>.*)$",
        serve,
        {"document_root": settings.FRONTEND_DIR / "assets"},
    ),
    path(
        "favicon.ico",
        lambda r: serve(r, "favicon.ico", document_root=settings.FRONTEND_DIR),
    ),
    # React SPA — root only
    path("", serve_index),
]
