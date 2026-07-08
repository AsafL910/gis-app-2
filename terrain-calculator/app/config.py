import os
import re
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = SERVICE_ROOT.parent


def _read_version() -> str:
    """Read the service version from pixi.toml (single source of truth)."""
    pixi_toml = SERVICE_ROOT / "pixi.toml"
    try:
        content = pixi_toml.read_text(encoding="utf-8")
        match = re.search(r'^version\s*=\s*"([^"]+)"', content, re.MULTILINE)
        if match:
            return match.group(1)
    except OSError:
        pass
    return "0.0.0"


SERVICE_VERSION = _read_version()
DATA_ROOT = Path(os.environ.get("DATA_DIR", str(WORKSPACE_ROOT / "data"))).resolve()
SETS_MANIFEST_PATH = DATA_ROOT / "sets.json"

RGB_ELEVATION_FORMULA = (
    "elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)"
)
