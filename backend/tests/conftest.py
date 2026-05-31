import os
import sys

# Ensure the repo root is importable so `from backend.main import app` works
# regardless of how pytest is invoked.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

# Use an isolated test database so tests never touch the dev/prod DB.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test_agentforge.db")
