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
