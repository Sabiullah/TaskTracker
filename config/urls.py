from django.conf import settings
from django.contrib import admin
from django.http import Http404, HttpResponse
from django.urls import include, path, re_path


def serve_index(request):
    index = settings.FRONTEND_DIR / "index.html"
    if not index.exists():
        raise Http404("React app not built yet. Run: npm run build")
    return HttpResponse(index.read_text(encoding="utf-8"), content_type="text/html")


urlpatterns = [
    # Django admin — must come before the React catch-all so /admin/ resolves
    # to Django's admin site instead of the SPA shell.
    path("admin/", admin.site.urls),
    # REST API — core small apps
    path("api/", include("core.masters.urls")),
    path("api/", include("core.tasks.urls")),
    path("api/", include("core.worklog.urls")),
    path("api/", include("core.notices.urls")),
    path("api/", include("core.leads.urls")),
    path("api/", include("core.invoices.urls")),
    path("api/", include("core.kaizen.urls")),
    path("api/", include("core.chat.urls")),
    path("api/", include("core.conveyance.urls")),
    path("api/", include("core.holidays.urls")),
    path("api/", include("core.settings_app.urls")),
    path("api/", include("core.employees.urls")),
    path("api/", include("core.attendance.urls")),
    path("api/", include("core.leave.urls")),
    path("api/", include("core.working_days.urls")),
    path("api/", include("core.growth.urls")),
    path("api/", include("core.pace.urls")),
    path("api/", include("core.backup.urls")),
    path("api/", include("core.audit.urls")),
    path("api/", include("users.urls")),
    # React SPA — WhiteNoise (dev) or nginx (prod) serves assets; Django serves
    # index.html for every non-Django route. The negative lookahead matches
    # each reserved prefix either followed by "/" or at end-of-string, so
    # "/admin" (no trailing slash) is excluded as well as "/admin/".
    re_path(r"^(?!(?:api|admin|static|media|ws)(?:/|$)).*$", serve_index),
]
