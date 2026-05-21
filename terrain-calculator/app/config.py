import os
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = SERVICE_ROOT.parent
DATA_ROOT = Path(os.environ.get("DATA_DIR", str(WORKSPACE_ROOT / "data"))).resolve()
SETS_MANIFEST_PATH = DATA_ROOT / "sets.json"

RGB_ELEVATION_FORMULA = (
    "elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)"
)
