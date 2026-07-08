import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import resolve_data_path
from src.main import app


class MapProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_resolve_data_path_rejects_traversal(self) -> None:
        with patch("src.config.DATA_DIR", Path("D:/workspace/data")):
            with self.assertRaises(ValueError):
                resolve_data_path("../outside.gpkg")

    def test_wmts_kvp_returns_400_for_invalid_tile_matrix(self) -> None:
        response = self.client.get(
            "/api/v1/wmts",
            params={
                "SERVICE": "WMTS",
                "REQUEST": "GetTile",
                "LAYER": "demo",
                "TILEMATRIXSET": "matrixset_demo",
                "TILEMATRIX": "bad",
                "TILEROW": "0",
                "TILECOL": "0",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("must be an integer", response.text)


if __name__ == "__main__":
    unittest.main()
