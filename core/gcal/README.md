# Google Calendar integration (`core.gcal`)

OAuth foundation for GC-1. Lets each Tasktracker user connect their personal
Google account so later features (GC-2 read overlay, GC-3 schedule meeting)
can call the Google Calendar API on their behalf.

## Environment variables

```
GCAL_CLIENT_ID=<from Google Cloud Console>
GCAL_CLIENT_SECRET=<from Google Cloud Console>
GCAL_REDIRECT_URI=http://localhost:8000/api/gcal/oauth-callback/
GCAL_FRONTEND_RETURN_URL=http://localhost:5173/settings/integrations
```

If `GCAL_CLIENT_ID` is empty, the `Connect` button is hidden on the frontend
and `/api/gcal/auth-url/` returns `503 {"error": "GCAL_NOT_CONFIGURED"}`.

## Google Cloud Console setup (one-time, manual)

1. Pick / create a Google Cloud project.
2. Enable the **Google Calendar API**.
3. **APIs & Services -> Credentials** -> create OAuth 2.0 Client ID (Web application).
4. Add authorized redirect URIs for every environment:
   - `http://localhost:8000/api/gcal/oauth-callback/` (dev)
   - `https://<prod-host>/api/gcal/oauth-callback/` (prod)
5. **OAuth consent screen** -> add scopes:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
   - `https://www.googleapis.com/auth/calendar.events`
6. Add yourself + teammates as test users during development.

### Production rollout

Calendar is a **sensitive** scope. Before exposing the integration to non-test
users in production, submit the OAuth consent screen for verification. Google's
manual review typically takes **2-6 weeks**. Start the verification process
early.

## Public API for downstream features

The single function GC-2 / GC-3 must use is:

```python
from core.gcal.services import get_user_credentials

creds = get_user_credentials(request.user)
if creds is None:
    # User isn't connected (or their refresh token was revoked).
    ...
else:
    # `creds` is a refreshed google.oauth2.credentials.Credentials object.
    from googleapiclient.discovery import build
    service = build("calendar", "v3", credentials=creds, cache_discovery=False)
    ...
```

`get_user_credentials` handles access-token refresh transparently and marks
the credential `revoked_at` if Google's refresh endpoint rejects us.

## Token storage notes

- Refresh tokens stored as plain text in Postgres. Treat as sensitive: never
  log, never return to the frontend.
- ModelAdmin excludes the token fields by default.
- Future hardening: encrypt at rest via `cryptography.Fernet`.
