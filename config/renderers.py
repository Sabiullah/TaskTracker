"""Custom DRF renderers."""

from rest_framework.renderers import JSONRenderer


class UTF8JSONRenderer(JSONRenderer):
    """JSON renderer that advertises its charset explicitly.

    DRF's stock ``JSONRenderer`` sends a bare ``application/json``
    Content-Type (JSON is UTF-8 by spec), but some clients — notably the
    WhatsApp desktop hand-off consuming text built from these responses —
    misdecode multi-byte characters when the charset isn't spelled out.
    Setting ``charset`` here makes every API response go out as
    ``Content-Type: application/json; charset=utf-8``.
    """

    charset = "utf-8"
