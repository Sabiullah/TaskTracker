"""OAuth ``state`` parameter - signed, time-limited, single-use-ish.

We embed the requesting user's id plus a random nonce. Django's
``TimestampSigner`` adds an HMAC signature and a timestamp; we enforce a
10-minute max age on verify. The nonce isn't strictly needed for security
(the signature already binds the state to our secret) but it ensures two
auth-url calls from the same user produce different state strings.
"""

import secrets

from django.core.signing import TimestampSigner

_SIGNER = TimestampSigner(salt="gcal.oauth.state")
_STATE_MAX_AGE_SECONDS = 600  # 10 minutes


def sign_state(user_id: int) -> str:
    nonce = secrets.token_urlsafe(16)
    return _SIGNER.sign(f"{user_id}:{nonce}")


def verify_state(state: str) -> int:
    """Return user_id if the state is valid.

    Raises ``django.core.signing.BadSignature`` on tamper and
    ``django.core.signing.SignatureExpired`` if older than 10 minutes.
    """
    unsigned = _SIGNER.unsign(state, max_age=_STATE_MAX_AGE_SECONDS)
    user_id_str, _nonce = unsigned.split(":", 1)
    return int(user_id_str)
