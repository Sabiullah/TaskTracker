import time
from unittest import mock

from django.core.signing import BadSignature, SignatureExpired
from django.test import TestCase

from core.gcal.models import GoogleCalendarCredential
from users.models import User


class GoogleCalendarCredentialModelTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="alice@example.com", password="x", full_name="Alice"
        )

    def test_create_minimal_credential(self):
        cred = GoogleCalendarCredential.objects.create(
            user=self.user,
            refresh_token="rt-abc",
        )
        self.assertEqual(cred.user, self.user)
        self.assertEqual(cred.refresh_token, "rt-abc")
        self.assertEqual(cred.access_token, "")
        self.assertIsNone(cred.access_token_expires_at)
        self.assertEqual(cred.google_email, "")
        self.assertEqual(cred.scopes, "")
        self.assertIsNone(cred.last_refreshed_at)
        self.assertIsNone(cred.revoked_at)
        self.assertIsNotNone(cred.created_at)

    def test_one_credential_per_user(self):
        GoogleCalendarCredential.objects.create(
            user=self.user, refresh_token="rt-1"
        )
        with self.assertRaises(Exception):
            GoogleCalendarCredential.objects.create(
                user=self.user, refresh_token="rt-2"
            )


class StateSigningTests(TestCase):
    def test_sign_and_verify_roundtrip(self):
        from core.gcal.state import sign_state, verify_state

        signed = sign_state(user_id=42)
        self.assertEqual(verify_state(signed), 42)

    def test_verify_rejects_tampered_state(self):
        from core.gcal.state import sign_state, verify_state

        signed = sign_state(user_id=42)
        tampered = signed[:-2] + "xx"
        with self.assertRaises(BadSignature):
            verify_state(tampered)

    def test_verify_rejects_expired_state(self):
        from core.gcal.state import sign_state, verify_state

        signed = sign_state(user_id=42)
        # Fast-forward time past the 10-minute window.
        with mock.patch(
            "django.core.signing.time.time",
            return_value=time.time() + 60 * 11,
        ):
            with self.assertRaises(SignatureExpired):
                verify_state(signed)

    def test_state_payload_includes_random_nonce(self):
        from core.gcal.state import sign_state

        a = sign_state(user_id=1)
        b = sign_state(user_id=1)
        self.assertNotEqual(a, b)


from urllib.parse import parse_qs, urlparse  # noqa: E402

from django.test import override_settings  # noqa: E402


@override_settings(
    GCAL_CLIENT_ID="test-client-id",
    GCAL_CLIENT_SECRET="test-client-secret",
    GCAL_REDIRECT_URI="http://localhost:8000/api/gcal/oauth-callback/",
    GCAL_FRONTEND_RETURN_URL="http://localhost:5173/settings/integrations",
)
class BuildAuthUrlTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="alice@example.com", password="x", full_name="Alice"
        )

    def test_build_auth_url_contains_expected_params(self):
        from core.gcal.services import build_auth_url

        url = build_auth_url(self.user)
        parsed = urlparse(url)
        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(parsed.netloc, "accounts.google.com")
        qs = parse_qs(parsed.query)
        self.assertEqual(qs["client_id"], ["test-client-id"])
        self.assertEqual(
            qs["redirect_uri"],
            ["http://localhost:8000/api/gcal/oauth-callback/"],
        )
        self.assertEqual(qs["response_type"], ["code"])
        self.assertEqual(qs["access_type"], ["offline"])
        self.assertEqual(qs["prompt"], ["consent"])
        scope_str = qs["scope"][0]
        self.assertIn(
            "https://www.googleapis.com/auth/calendar.events", scope_str
        )
        self.assertIn("openid", scope_str)
        self.assertIn("email", scope_str)
        self.assertIn("profile", scope_str)
        # State must be a non-empty signed string.
        self.assertTrue(qs["state"][0])


from datetime import datetime, timedelta, timezone  # noqa: E402

from django.utils import timezone as djtz  # noqa: E402
from google.oauth2.credentials import Credentials  # noqa: E402


@override_settings(
    GCAL_CLIENT_ID="test-client-id",
    GCAL_CLIENT_SECRET="test-client-secret",
    GCAL_REDIRECT_URI="http://localhost:8000/api/gcal/oauth-callback/",
)
class ExchangeCodeAndSaveTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="alice@example.com", password="x", full_name="Alice"
        )

    def test_happy_path_creates_credential(self):
        from core.gcal import services
        from core.gcal.services import exchange_code_and_save

        fake_creds = Credentials(
            token="at-1",
            refresh_token="rt-1",
            token_uri="https://oauth2.googleapis.com/token",
            client_id="test-client-id",
            client_secret="test-client-secret",
            scopes=["openid", "email"],
            expiry=datetime(2099, 1, 1),
        )

        class FakeFlow:
            credentials = fake_creds

            def fetch_token(self, code: str) -> None:
                self.fetched_code = code

        with mock.patch.object(services, "_flow", return_value=FakeFlow()):
            with mock.patch.object(
                services,
                "_fetch_userinfo_email",
                return_value="alice@gmail.com",
            ):
                cred = exchange_code_and_save(self.user, "abc-code")

        self.assertEqual(cred.user, self.user)
        self.assertEqual(cred.refresh_token, "rt-1")
        self.assertEqual(cred.access_token, "at-1")
        self.assertEqual(cred.google_email, "alice@gmail.com")
        self.assertIn("openid", cred.scopes.split())
        self.assertEqual(GoogleCalendarCredential.objects.count(), 1)

    def test_second_exchange_overwrites_first(self):
        from core.gcal import services
        from core.gcal.services import exchange_code_and_save

        def make_flow(token: str, refresh: str):
            creds = Credentials(
                token=token,
                refresh_token=refresh,
                token_uri="https://oauth2.googleapis.com/token",
                client_id="test-client-id",
                client_secret="test-client-secret",
                scopes=["openid"],
                expiry=datetime(2099, 1, 1),
            )

            class FakeFlow:
                credentials = creds

                def fetch_token(self, code: str) -> None:
                    pass

            return FakeFlow()

        with mock.patch.object(
            services, "_flow", side_effect=lambda: make_flow("at-1", "rt-1")
        ):
            with mock.patch.object(
                services, "_fetch_userinfo_email", return_value="a@gmail.com"
            ):
                exchange_code_and_save(self.user, "code-1")

        with mock.patch.object(
            services, "_flow", side_effect=lambda: make_flow("at-2", "rt-2")
        ):
            with mock.patch.object(
                services, "_fetch_userinfo_email", return_value="b@gmail.com"
            ):
                exchange_code_and_save(self.user, "code-2")

        self.assertEqual(GoogleCalendarCredential.objects.count(), 1)
        cred = GoogleCalendarCredential.objects.get()
        self.assertEqual(cred.refresh_token, "rt-2")
        self.assertEqual(cred.google_email, "b@gmail.com")


@override_settings(
    GCAL_CLIENT_ID="test-client-id",
    GCAL_CLIENT_SECRET="test-client-secret",
    GCAL_REDIRECT_URI="http://localhost:8000/api/gcal/oauth-callback/",
)
class GetUserCredentialsTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="alice@example.com", password="x", full_name="Alice"
        )

    def test_returns_none_when_no_credential(self):
        from core.gcal.services import get_user_credentials

        self.assertIsNone(get_user_credentials(self.user))

    def test_returns_none_when_revoked(self):
        from core.gcal.services import get_user_credentials

        GoogleCalendarCredential.objects.create(
            user=self.user,
            refresh_token="rt-1",
            access_token="at-1",
            access_token_expires_at=djtz.now() + timedelta(hours=1),
            scopes="openid",
            revoked_at=djtz.now(),
        )
        self.assertIsNone(get_user_credentials(self.user))

    def test_returns_credentials_when_access_token_fresh(self):
        from core.gcal.services import get_user_credentials

        GoogleCalendarCredential.objects.create(
            user=self.user,
            refresh_token="rt-1",
            access_token="at-1",
            access_token_expires_at=djtz.now() + timedelta(hours=1),
            scopes="openid",
        )
        creds = get_user_credentials(self.user)
        self.assertIsNotNone(creds)
        self.assertEqual(creds.token, "at-1")

    def test_refreshes_when_access_token_expired(self):
        from core.gcal.services import get_user_credentials

        GoogleCalendarCredential.objects.create(
            user=self.user,
            refresh_token="rt-1",
            access_token="at-old",
            access_token_expires_at=djtz.now() - timedelta(seconds=10),
            scopes="openid",
        )

        def fake_refresh(self, request):
            self.token = "at-new"
            self.expiry = datetime(2099, 1, 1)

        with mock.patch.object(Credentials, "refresh", fake_refresh):
            creds = get_user_credentials(self.user)

        self.assertIsNotNone(creds)
        self.assertEqual(creds.token, "at-new")

        # Row got persisted with the new access token.
        row = GoogleCalendarCredential.objects.get(user=self.user)
        self.assertEqual(row.access_token, "at-new")
        self.assertIsNotNone(row.last_refreshed_at)

    def test_refresh_failure_marks_revoked_and_returns_none(self):
        from core.gcal.services import get_user_credentials

        GoogleCalendarCredential.objects.create(
            user=self.user,
            refresh_token="rt-1",
            access_token="at-old",
            access_token_expires_at=djtz.now() - timedelta(seconds=10),
            scopes="openid",
        )

        from google.auth.exceptions import RefreshError

        def boom(self, request):
            raise RefreshError("revoked by user")

        with mock.patch.object(Credentials, "refresh", boom):
            result = get_user_credentials(self.user)

        self.assertIsNone(result)
        row = GoogleCalendarCredential.objects.get(user=self.user)
        self.assertIsNotNone(row.revoked_at)


class RevokeAndDeleteTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="alice@example.com", password="x", full_name="Alice"
        )

    def test_revoke_and_delete_calls_google_then_deletes(self):
        from core.gcal import services
        from core.gcal.services import revoke_and_delete

        GoogleCalendarCredential.objects.create(
            user=self.user,
            refresh_token="rt-1",
        )

        with mock.patch.object(services, "requests") as mock_requests:
            mock_requests.post.return_value.ok = True
            revoke_and_delete(self.user)

        mock_requests.post.assert_called_once()
        self.assertEqual(GoogleCalendarCredential.objects.count(), 0)

    def test_delete_still_happens_when_revoke_fails(self):
        from core.gcal import services
        from core.gcal.services import revoke_and_delete

        GoogleCalendarCredential.objects.create(
            user=self.user,
            refresh_token="rt-1",
        )

        with mock.patch.object(services, "requests") as mock_requests:
            mock_requests.post.return_value.ok = False
            mock_requests.post.return_value.status_code = 400
            revoke_and_delete(self.user)

        self.assertEqual(GoogleCalendarCredential.objects.count(), 0)

    def test_noop_when_no_credential(self):
        from core.gcal.services import revoke_and_delete

        revoke_and_delete(self.user)  # Should not raise.
