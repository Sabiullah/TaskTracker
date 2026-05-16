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
