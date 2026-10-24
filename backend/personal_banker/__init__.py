"""Personal Banker backend.

Settings come from the one .env in the repository root, shared with the Expo app
(see .env.example there). Variables already set in the environment win.
"""

from pathlib import Path

from dotenv import load_dotenv

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"

load_dotenv(ENV_FILE)
