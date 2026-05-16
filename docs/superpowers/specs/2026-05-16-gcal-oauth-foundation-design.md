# Google Calendar OAuth Foundation (GC-1)

**Date:** 2026-05-16
**Branch:** `gcal-oauth-foundation` (cut from `main`; not stacked on `Calendar_subtask`)
**Status:** Spec for implementation

## Problem

To eventually overlay Google Calendar events on the Tasktracker calendar (GC-2) and let users schedule meetings from a task (GC-3), each user must first connect their personal Google account and grant Tasktracker access to their calendar. There is no integrations surface today — no Settings page, no per-user OAuth credentials, no token storage, no server-side Google API client. This spec covers only the foundation: the parts every other GCal feature will sit on top of.

## Goals

- A new top-level `Settings` view with one tab (`Integrations`) and one card (`Google Calendar`).
- Per-user OAuth flow: user clicks `Connect Google Calendar`, completes Google's consent on `accounts.google.com`, returns to Tasktracker with a stored refresh token.
- Upfront scope: `https://www.googleapis.com/auth/calendar.events` so GC-2 and GC-3 require no further consent.
- Backend service `get_user_credentials(user)` returning a refreshed Google API `Credentials` object — the single integration point downstream specs depend on.
- Disconnect flow that revokes the refresh token on Google and deletes the local record.
- All frontend work is lazy-loaded and isolated to the Settings page so the rest of the app's bundle and runtime are unaffected.

## Non-goals

- Reading calendar events (`GC-2`) or writing them (`GC-3`).
- Encryption of the refresh token at rest. Token stored as plain text in Postgres; the column is treated as sensitive and protected by existing DB access controls. Migration to encryption is a future change.
- Google push notifications / webhooks. Token freshness is on-demand only.
- Multiple Google accounts per Tasktracker user. One `OneToOneField` enforces a single connection.
- Org-shared / service-account calendars. Each connection is personal.
- Background workers, Celery, cron — no async refresh, no scheduled sync. Refresh happens lazily inside `get_user_credentials`.
- Audit log entries for connect / disconnect. Can land later if the user wants it.
- New permissions / roles. Connecting one's own calendar requires only a valid Tasktracker session.

## Architecture

```
Frontend (lazy-loaded Settings page)
    │
    │  GET /api/gcal/status/   ───────► { connected: false }
    │                                   OR { connected: true, google_email, scopes, connected_at }
    │  GET /api/gcal/auth-url/ ───────► { url: "https://accounts.google.com/o/oauth2/v2/auth?..." }
    │  → window.location.href = url
    │
Google OAuth consent ─── (user approves) ──┐
                                            ▼
    Backend  GET /api/gcal/oauth-callback/?code=...&state=...
        ├── verifies signed state (Django TimestampSigner)
        ├── exchanges code → tokens via google-auth-oauthlib
        ├── upserts GoogleCalendarCredential
        └── 302 to <frontend>/settings/integrations?gcal=connected
            (or ?gcal=error&reason=... on failure)

    DELETE /api/gcal/credential/  ───► revoke refresh_token on Google, delete row
```

The frontend never sees tokens. The backend caches access tokens with their expiry and refreshes on demand. Token refresh is lazy: it only runs when something asks for credentials.

### Components and responsibilities

**Backend — new app `core/gcal/`:**

| File | Responsibility |
|------|---------------|
| `apps.py` | Django `AppConfig` (`name = "core.gcal"`). |
| `models.py` | `GoogleCalendarCredential` model. |
| `state.py` | Sign / verify the OAuth `state` parameter using `django.core.signing.TimestampSigner`. |
| `services.py` | `build_auth_url`, `exchange_code_and_save`, `get_user_credentials`, `revoke_and_delete`. The only place that talks to Google. |
| `views.py` | Four endpoints (auth-url, oauth-callback, status, disconnect). Thin: delegate to `services`. |
| `serializers.py` | Status / disconnect response DTOs. |
| `urls.py` | Route table mounted under `/api/gcal/`. |
| `tests.py` | Unit + integration coverage. |
| `migrations/0001_initial.py` | Schema. |
| `README.md` | Google Cloud Console setup + env vars + dev/prod redirect URIs. |

**Frontend:**

| File | Responsibility |
|------|---------------|
| `src/pages/SettingsPage.tsx` (new) | Shell with one tab. Lazy-loaded by `App.tsx`. |
| `src/components/settings/IntegrationsTab.tsx` (new) | Hosts `GoogleCalendarCard`; future integrations slot in here. |
| `src/components/settings/GoogleCalendarCard.tsx` (new) | Three states (loading / not connected / connected). Connect + Disconnect actions. Reads `?gcal=...` from URL once on mount for the success/error toast. |
| `src/lib/api/gcal.ts` (new) | `getGcalStatus()`, `getGcalAuthUrl()`, `disconnectGcal()`. |
| `src/types/api/gcal.ts` (new) | `GcalStatusDto`, `GcalAuthUrlDto`. |
| `src/App.tsx` | Register `settings` view in `VIEW_MAP` with `React.lazy`. |
| `src/components/layout/Header.tsx` | Add `Settings` nav item (visible to every signed-in user). |
| `src/__tests__/components/settings/googleCalendarCard.test.tsx` (new) | Renders all three states; asserts button wiring. |

## Data model

```python
# core/gcal/models.py
class GoogleCalendarCredential(TimeStampedModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="gcal_credential",
    )
    refresh_token = models.TextField()  # SENSITIVE: never log
    access_token = models.TextField(blank=True)
    access_token_expires_at = models.DateTimeField(null=True, blank=True)
    google_email = models.EmailField(blank=True)
    scopes = models.TextField(blank=True)  # space-separated
    last_refreshed_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)  # soft-revoke marker

    class Meta:
        verbose_name = "Google Calendar credential"
```

- `OneToOneField` enforces one-connection-per-user.
- `revoked_at` lets us mark a credential dead without dropping the row (useful if we later want a "reconnect" prompt that remembers the previous email).
- All fields nullable / blankable except `user` and `refresh_token` — a row exists if and only if we successfully exchanged a code.

## API surface

All four endpoints under `/api/gcal/`.

### `GET /api/gcal/auth-url/`

- **Auth:** JWT required.
- **Response:** `{ url: "<google consent url>" }`.
- Builds the URL using `google_auth_oauthlib.flow.Flow.authorization_url`, embedding signed state, `access_type=offline`, `prompt=consent`, and `scope=openid email profile https://www.googleapis.com/auth/calendar.events`.
- `prompt=consent` is set so revoked tokens definitely return a new refresh_token on reconnect.

### `GET /api/gcal/oauth-callback/?code=...&state=...`

- **Auth:** none (Google's redirect can't carry our JWT).
- **CSRF defense:** signed `state` token, 10-minute max age.
- **Flow:**
  1. Parse `state`; reject (302 to `?gcal=error&reason=bad_state`) on signature or expiry failure.
  2. Extract `user_id` from the state payload; fetch the User.
  3. `flow.fetch_token(code=code)` — exchanges code for tokens.
  4. Hit Google's `/userinfo` endpoint to capture the email (one extra HTTP call; cached on the credential).
  5. `update_or_create` the credential row.
  6. 302 to `<GCAL_FRONTEND_RETURN_URL>?gcal=connected`.
- On Google error / network failure: 302 to `?gcal=error&reason=<short_slug>` so the frontend can show a useful toast. Reasons: `bad_state`, `code_exchange_failed`, `userinfo_failed`, `unknown`.

### `GET /api/gcal/status/`

- **Auth:** JWT required.
- **Response:**
  - Not connected: `{ connected: false }`.
  - Connected: `{ connected: true, google_email, scopes: ["..."], connected_at, last_refreshed_at }`.
- Never returns the refresh token or the access token.
- Single DB query (`GoogleCalendarCredential.objects.filter(user=request.user).first()`).

### `DELETE /api/gcal/credential/`

- **Auth:** JWT required.
- **Response:** `{ disconnected: true }`.
- POSTs to `https://oauth2.googleapis.com/revoke?token=<refresh_token>`; on any response we then delete the local row. Best-effort: a failed revoke does not block disconnection (Google may already have revoked it).
- If no credential exists, returns `{ disconnected: true }` (idempotent).

## State token

Implemented in `core/gcal/state.py`:

```python
from django.core.signing import TimestampSigner, BadSignature, SignatureExpired

_SIGNER = TimestampSigner(salt="gcal.oauth.state")
_STATE_MAX_AGE_SECONDS = 600  # 10 minutes


def sign_state(user_id: int) -> str:
    nonce = secrets.token_urlsafe(16)
    return _SIGNER.sign(f"{user_id}:{nonce}")


def verify_state(state: str) -> int:
    """Return user_id if valid; raise BadSignature on tamper or expiry."""
    unsigned = _SIGNER.unsign(state, max_age=_STATE_MAX_AGE_SECONDS)
    user_id_str, _nonce = unsigned.split(":", 1)
    return int(user_id_str)
```

Salt isolates the signer from any other use of `TimestampSigner` in the codebase.

## Service layer

`core/gcal/services.py` exposes exactly four functions. All HTTP to Google goes through here.

```python
def build_auth_url(user: User) -> str: ...

def exchange_code_and_save(user: User, code: str) -> GoogleCalendarCredential: ...

def get_user_credentials(user: User) -> Credentials | None:
    """
    Returns a refreshed google.oauth2.credentials.Credentials object.
    Refreshes the access token if expired and persists the new one.
    Returns None if the user has no credential or it was marked revoked.
    """

def revoke_and_delete(user: User) -> None: ...
```

`get_user_credentials` is the single seam GC-2 and GC-3 will call. Their code never imports `google_auth_oauthlib.flow` directly.

Refresh logic:
1. If `access_token_expires_at` is in the future (with a 60-second buffer), return the current credentials.
2. Otherwise, call `creds.refresh(Request())` on a `Credentials(refresh_token=...)` object.
3. Save the new `token`, `expiry`, `last_refreshed_at` to the DB.
4. If refresh fails with `RefreshError`, set `revoked_at = now()` and return None.

## Frontend behavior

### Settings page registration

In `App.tsx`:

```ts
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
// inside VIEW_MAP:
settings: <SettingsPage profile={profile} />
```

In `Header.tsx`'s nav items array, add `{ id: "settings", label: "Settings", icon: <GearIcon /> }`. Visible to every signed-in user.

### `GoogleCalendarCard` states

1. **Loading** — initial mount. Shows a skeleton (no spinner; the existing app uses skeletons in similar places — match local convention; if there's no precedent, a centered spinner is fine).
2. **Not connected** — primary button `Connect Google Calendar`. Click: `getGcalAuthUrl()` then `window.location.href = res.url`.
3. **Connected** — secondary text rows:
   - `Connected as <google_email>`
   - `Scopes: calendar.events`
   - `Since <connected_at, formatted>`
   - Danger button `Disconnect`. Click: confirm modal, then `disconnectGcal()`, then re-fetch status.

### Return-from-Google toast

On mount, the card reads `window.location.search` once. If `gcal=connected`, show a green toast `Google Calendar connected.`; if `gcal=error`, show a red toast `Couldn't connect: <reason>.` Either way, strip the query param via `history.replaceState`.

### Performance posture (explicit, per user requirement)

- `SettingsPage` is loaded via `React.lazy` so the main bundle is unchanged.
- Status fetched **once on mount**. No polling, no interval, no WebSocket subscription.
- No new global context, no new provider. State is local to the card.
- `gcal.ts` API client adds ~30 lines of TS — negligible.
- The new Header nav item is a single icon; no measurable render cost.

## Configuration / deployment

Four new env vars (read via `environ.Env`):

```
GCAL_CLIENT_ID=<from Google Cloud Console>
GCAL_CLIENT_SECRET=<from Google Cloud Console>
GCAL_REDIRECT_URI=http://localhost:8000/api/gcal/oauth-callback/
GCAL_FRONTEND_RETURN_URL=http://localhost:5173/settings/integrations
```

In `config/settings.py`:

```python
GCAL_CLIENT_ID = env.str("GCAL_CLIENT_ID", default="")
GCAL_CLIENT_SECRET = env.str("GCAL_CLIENT_SECRET", default="")
GCAL_REDIRECT_URI = env.str("GCAL_REDIRECT_URI", default="")
GCAL_FRONTEND_RETURN_URL = env.str("GCAL_FRONTEND_RETURN_URL", default="")
```

If `GCAL_CLIENT_ID` is empty, the `Connect` button is hidden in the frontend and the `/api/gcal/auth-url/` endpoint returns `503 {"error": "GCAL_NOT_CONFIGURED"}`. This lets the spec ship without breaking environments that haven't completed Google Cloud Console setup.

### Google Cloud Console setup (one-time, manual)

Documented in `core/gcal/README.md`:

1. Create / pick a Google Cloud project.
2. Enable the Google Calendar API.
3. Create an OAuth 2.0 Client ID (Web application).
4. Add authorized redirect URIs for every environment:
   - `http://localhost:8000/api/gcal/oauth-callback/` (dev)
   - `https://<prod-host>/api/gcal/oauth-callback/` (prod)
5. On the OAuth consent screen, add scopes: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/calendar.events`.
6. Add yourself + teammates as test users during development.
7. **Production rollout:** Calendar is a *sensitive* scope; before exposing to non-test users, submit the OAuth consent screen for verification. Google's manual review typically takes 2–6 weeks. This is a real calendar risk that should not surprise the user at launch time.

### Dependencies

Add to `pyproject.toml`:

```
google-auth>=2.30
google-auth-oauthlib>=1.2
requests>=2.31
```

`requests` is needed for the revoke endpoint (no Google client lib wraps it) and for the `/userinfo` call.

## Security posture

- Refresh token stored as plain text in Postgres. Column comments + admin restrictions prevent it surfacing in the Django admin (`exclude = ("refresh_token", "access_token")` on the ModelAdmin).
- Logging: no logger anywhere in `core/gcal/` is permitted to take `refresh_token` or `access_token` as an argument. Code review must enforce this; we add a doctring rule to `services.py`.
- Tokens never returned to the frontend. `serializers.py` defines a read serializer that explicitly does NOT include the token fields.
- The `oauth-callback` endpoint is unauthenticated by necessity but protected by signed `state`. Without a valid state, the endpoint 302's to an error page.
- CORS / CSRF: the callback is a top-level GET from `accounts.google.com` to our backend, so it bypasses our CORS policy. CSRF doesn't apply (GET, no side-effect from the user's perspective — the side effect is the token exchange we initiated).
- Disconnect always tries Google's revoke endpoint. If revoke fails with 5xx we still delete locally; the token may live until its natural expiry but the user is removed from our system as expected.

## Edge cases

- **User connects, then revokes access in Google's UI.** Next `get_user_credentials` call refreshes, gets `RefreshError`, sets `revoked_at`, returns `None`. Frontend status endpoint shows `connected: true` until the next downstream call detects it — acceptable for v1; we surface a clearer state in GC-2 when the read overlay actually exercises the path. To keep the status endpoint accurate without polling Google, we treat `revoked_at IS NOT NULL` as effectively disconnected: status returns `connected: false`.
- **User connects with one Google account, disconnects, connects with another.** The `OneToOneField` + `update_or_create` lets the second connect overwrite the first row cleanly.
- **OAuth state replay.** The signed state has a 10-minute max age and a per-request nonce. It is not stored server-side, so a stolen state could in theory be replayed within 10 minutes — but Google itself invalidates the `code` on first use, so the replay would fail at the code exchange step. Acceptable.
- **Concurrent refreshes** (two requests hit `get_user_credentials` at the same time). Last-write-wins on the access token. Both callers get a valid access token (theirs or the one they read on retry). No locking needed for a v1 access-token cache.
- **`GCAL_CLIENT_ID` unset.** `Connect` button hidden; `/api/gcal/auth-url/` returns 503. Spec ships green; setup can complete on its own schedule.
- **Frontend opened from a different domain than the configured callback.** Google would refuse with `redirect_uri_mismatch`; our callback never runs; user sees Google's error page. We do not try to handle this — it indicates misconfiguration.
- **User row deleted (cascade).** `OneToOneField(on_delete=CASCADE)` drops the credential. Google's refresh token continues to exist but Tasktracker can't use it anymore; the user can revoke from Google's account settings.

## Testing

### `state.py` (unit)

- Sign → verify round-trip returns the original user_id.
- Verify rejects a tampered string with `BadSignature`.
- Verify rejects a string older than 10 minutes with `SignatureExpired` (use `freezegun` or monkey-patch `time.time`).

### `services.py` (mocked HTTP)

Using `responses` or `unittest.mock` to mock `google_auth_oauthlib` and `requests.post`:

- `build_auth_url` produces a URL containing: our client_id, the configured redirect_uri, the calendar.events scope, `access_type=offline`, `prompt=consent`, and a valid signed state.
- `exchange_code_and_save` happy path: creates a credential row with refresh_token, access_token, expiry, scopes, and google_email pulled from the userinfo endpoint.
- `exchange_code_and_save` Google error: raises a domain exception (`GcalCodeExchangeFailed`); no row is created.
- `get_user_credentials` returns None when no credential exists.
- `get_user_credentials` returns None when `revoked_at` is set.
- `get_user_credentials` returns the existing credentials object when the access token is still valid.
- `get_user_credentials` refreshes when expired, persists the new access token + expiry + `last_refreshed_at`, and returns the refreshed object.
- `get_user_credentials` on `RefreshError` sets `revoked_at` and returns None.
- `revoke_and_delete` calls the Google revoke endpoint exactly once and deletes the row. Local delete still happens if revoke 4xx's or 5xx's.

### Views (Django test client)

- `auth-url`: 401 without auth; 200 with JWT; response JSON contains `url`.
- `status`: 200 with auth, `{ connected: false }` when no record.
- `status`: 200 with auth, `{ connected: true, ... }` when record exists and not revoked.
- `status`: returns `connected: false` when `revoked_at IS NOT NULL`.
- `oauth-callback`: 302 to `?gcal=error&reason=bad_state` when state is missing.
- `oauth-callback`: 302 to `?gcal=error&reason=bad_state` when state is signed with a wrong key.
- `oauth-callback`: 302 to `?gcal=connected` on happy path; verifies a row was created.
- `oauth-callback`: 302 to `?gcal=error&reason=code_exchange_failed` when Google returns an error.
- `disconnect`: 401 without auth; 200 on success; row removed; revoke called.
- `disconnect`: 200 even when revoke fails (best-effort).
- `auth-url` when `GCAL_CLIENT_ID` is empty: returns 503 with `{"error": "GCAL_NOT_CONFIGURED"}`.

### Frontend

`__tests__/components/settings/googleCalendarCard.test.tsx`:
- Renders skeleton on mount before the status fetch resolves.
- Renders the Connect button when status returns `{ connected: false }`.
- Renders the email + Disconnect button when status returns `{ connected: true, google_email: "x@y.com", ... }`.
- Clicking Connect calls `getGcalAuthUrl` and sets `window.location.href`.
- Clicking Disconnect prompts confirmation, then calls `disconnectGcal`, then re-fetches.

## Files touched

**Backend (new):**
- `core/gcal/__init__.py`
- `core/gcal/apps.py`
- `core/gcal/models.py`
- `core/gcal/state.py`
- `core/gcal/services.py`
- `core/gcal/views.py`
- `core/gcal/serializers.py`
- `core/gcal/urls.py`
- `core/gcal/tests.py`
- `core/gcal/migrations/__init__.py`
- `core/gcal/migrations/0001_initial.py`
- `core/gcal/README.md`

**Backend (modified):**
- `config/settings.py` — register `core.gcal` and four env vars.
- `config/urls.py` — include `core.gcal.urls`.
- `pyproject.toml` — add `google-auth`, `google-auth-oauthlib`, `requests`.

**Frontend (new):**
- `frontend/task-tracker/src/pages/SettingsPage.tsx`
- `frontend/task-tracker/src/components/settings/IntegrationsTab.tsx`
- `frontend/task-tracker/src/components/settings/GoogleCalendarCard.tsx`
- `frontend/task-tracker/src/lib/api/gcal.ts`
- `frontend/task-tracker/src/types/api/gcal.ts`
- `frontend/task-tracker/src/__tests__/components/settings/googleCalendarCard.test.tsx`

**Frontend (modified):**
- `frontend/task-tracker/src/App.tsx` — register `settings` view, lazy-load.
- `frontend/task-tracker/src/components/layout/Header.tsx` — `Settings` nav item.

## Trade-offs and risks

- **Plain-text token storage.** Acceptable per stakeholder decision; documented as a future hardening (encrypt-at-rest). Mitigations: column never logged, never sent to the frontend, admin form excludes the field.
- **Lazy refresh, not background refresh.** A user who connects today and doesn't use any GCal feature for a week may still have a fresh access token only because Google's tokens last an hour and the refresh-on-demand path always works; we just don't pre-warm. Acceptable since there is no scheduled work in GC-1.
- **Google verification timeline.** If the team waits until launch to start verification, non-test users will see Google's scary "unverified app" warning until verification clears. The spec documents this so the team can start the process early.
- **No `state` server-side store.** We rely on cryptographic signing rather than a server-stored nonce. This is the documented practice for OAuth state in stateless web apps and is what Django's `TimestampSigner` is designed for.
- **`OneToOneField` permanently couples a user to one Google account.** If we later need "switch account without disconnect-first", we'll widen to `ForeignKey` + a `default=True` flag. Out of scope for v1; the migration would be straightforward.

## Out of scope (deferred)

- Encryption at rest (`cryptography.Fernet`).
- Reading calendar events (`GC-2`).
- Writing events from task modal (`GC-3`).
- Multi-Google-account-per-user.
- Org-shared calendars.
- Audit log entries.
- Reconnect flow that remembers the previous email (`revoked_at` already in schema; UI for it is future).
- Webhook-based push notifications.
