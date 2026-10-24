"""Who may call the API: users signed in to the app with Clerk, and scripts with a static token.

The app sends the signed-in user's Clerk session token, an RS256 JWT. It is
checked against the public keys of the Clerk instance named in the publishable
key (pk_test_<base64 of "<frontend API host>$">): the app's
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY from the shared root .env. CLERK_PUBLISHABLE_KEY,
when set, takes precedence (for running the backend without the app's .env).

PERSONAL_BANKER_API_TOKEN, when set, is accepted too, for curl and scripts.
CLERK_ALLOWED_USER_IDS (comma-separated Clerk user ids) limits the API to those
users; without it, anyone who can sign in to the Clerk instance gets in.
With neither key nor token set, the API is open.
"""

import base64
import functools
import os
import re
import secrets

import jwt

CLERK_KEY_ENV = "CLERK_PUBLISHABLE_KEY"
APP_CLERK_KEY_ENV = "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY"
TOKEN_ENV = "PERSONAL_BANKER_API_TOKEN"
ALLOWED_USERS_ENV = "CLERK_ALLOWED_USER_IDS"

# A browser session's token names the page's origin in azp; the same origins CORS allows.
AUTHORIZED_PARTIES = re.compile(r"http://(localhost|127\.0\.0\.1)(:\d+)?")
# Session tokens live for a minute; allow for a little clock drift.
LEEWAY_SECONDS = 10


class AuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def frontend_api(publishable_key: str) -> str:
    """The Clerk Frontend API host a publishable key belongs to, e.g. 'example-1.clerk.accounts.dev'."""
    encoded = publishable_key.split("_", 2)[-1]
    return base64.b64decode(encoded + "=" * (-len(encoded) % 4)).decode().rstrip("$")


@functools.cache
def _jwks(host: str) -> jwt.PyJWKClient:
    # Caches the keys; fetches them again when a token names a key it hasn't seen.
    return jwt.PyJWKClient(f"https://{host}/.well-known/jwks.json")


def verify_session_token(token: str, publishable_key: str) -> dict:
    """The token's claims, once its signature, issuer, lifetime and origin check out; raises jwt.PyJWTError."""
    host = frontend_api(publishable_key)
    claims = jwt.decode(
        token,
        _jwks(host).get_signing_key_from_jwt(token).key,
        algorithms=["RS256"],
        issuer=f"https://{host}",
        leeway=LEEWAY_SECONDS,
        options={"require": ["exp", "iat", "sub"]},
    )
    if (azp := claims.get("azp")) and not AUTHORIZED_PARTIES.fullmatch(azp):
        raise jwt.InvalidTokenError(f"the token was issued to {azp}")
    if claims.get("sts") == "pending":
        raise jwt.InvalidTokenError("the session isn't fully signed in yet")
    return claims


def publishable_key() -> str | None:
    return os.environ.get(CLERK_KEY_ENV) or os.environ.get(APP_CLERK_KEY_ENV)


def is_open() -> bool:
    return not publishable_key() and not os.environ.get(TOKEN_ENV)


def authorize(token: str | None) -> str:
    """Who is calling: a Clerk user id, "api-token", or "anyone" when auth isn't set up. Raises AuthError."""
    if is_open():
        return "anyone"
    if not token:
        raise AuthError(401, "Sign in first: the request had no session token.")
    static = os.environ.get(TOKEN_ENV)
    if static and secrets.compare_digest(token.encode(), static.encode()):
        return "api-token"
    if not (key := publishable_key()):
        raise AuthError(401, "Wrong API token.")
    try:
        user_id = verify_session_token(token, key)["sub"]
    except jwt.PyJWTError as e:  # includes failing to fetch the keys
        raise AuthError(401, f"Invalid session token: {e}") from e
    allowed = {u.strip() for u in os.environ.get(ALLOWED_USERS_ENV, "").split(",") if u.strip()}
    if allowed and user_id not in allowed:
        raise AuthError(403, "This account isn't allowed to use this server.")
    return user_id
