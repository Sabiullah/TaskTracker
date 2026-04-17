from django.db import models


class TimeStampedModel(models.Model):
    """Adds created_at / updated_at to every model that inherits it."""

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class UidLookupMixin:
    """ViewSet mixin: match UUIDs in the URL and look up rows by `uid`.

    The frontend uses ``uid`` as the external identifier (never exposes the
    integer primary key), so every detail URL looks like
    ``/api/<resource>/<uuid>/``. Mix this in alongside ``ModelViewSet``.
    """

    lookup_field = "uid"
    lookup_value_regex = "[0-9a-fA-F-]{36}"
