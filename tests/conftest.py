import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Tests must never reach the network: the AI layer falls back to the rules.
os.environ.setdefault("AI_ENABLED", "false")
