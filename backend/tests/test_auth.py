import re

from personal_banker import auth


def test_web_origins_allow_localhost_and_the_hosted_app(monkeypatch):
    monkeypatch.setenv(auth.WEB_ORIGINS_ENV, "https://money-app.expo.app/, https://other.example")
    origins = re.compile(auth.web_origins())
    assert origins.fullmatch("http://localhost:8081")
    assert origins.fullmatch("http://127.0.0.1")
    assert origins.fullmatch("https://money-app.expo.app")
    assert origins.fullmatch("https://other.example")
    assert not origins.fullmatch("https://money-appXexpo.app")
    assert not origins.fullmatch("https://money-app.expo.app.evil.com")
    assert not origins.fullmatch("https://evil.com")


def test_web_origins_without_hosted_app(monkeypatch):
    monkeypatch.delenv(auth.WEB_ORIGINS_ENV, raising=False)
    origins = re.compile(auth.web_origins())
    assert origins.fullmatch("http://localhost:8081")
    assert not origins.fullmatch("https://money-app.expo.app")
