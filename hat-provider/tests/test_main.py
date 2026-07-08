import unittest
import sys
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import _source_entries, app
from app.models import GpkgSourceMetadata, TileMatrixMetadata, TileTableMetadata
from app.services.terrain_rendering import render_terrain_rgb_tile


class HatProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def test_source_entries_respect_vrt_order(self) -> None:
        map_set = {
            "name": "Demo Set",
            "vrtPath": "/tmp/demo.vrt",
            "dtmLayers": [
                {"path": "/data/b.gpkg", "priority": 2},
                {"path": "/data/a.gpkg", "priority": 1},
                {"path": "/data/c.gpkg", "priority": 3},
            ],
        }

        with patch("app.main.inspect_vrt_source_paths", return_value=("/data/a.gpkg", "/data/c.gpkg")):
            entries = _source_entries(map_set)

        self.assertEqual([entry["path"] for entry in entries], ["/data/a.gpkg", "/data/c.gpkg", "/data/b.gpkg"])

    def test_versioned_openapi_is_exposed(self) -> None:
        matrix = TileMatrixMetadata(
            zoom_level=0,
            matrix_width=1,
            matrix_height=1,
            tile_width=256,
            tile_height=256,
            pixel_x_size=1.0,
            pixel_y_size=1.0,
            min_tile_col=0,
            max_tile_col=0,
            min_tile_row=0,
            max_tile_row=0,
        )
        source = GpkgSourceMetadata(
            path="/data/demo.gpkg",
            tables=(
                TileTableMetadata(
                    table_name="terrain",
                    identifier="terrain",
                    srs_id=4326,
                    supported_crs="EPSG:4326",
                    bounds=(0.0, 0.0, 1.0, 1.0),
                    tile_matrices=(matrix,),
                    mime_type="image/png",
                    file_extension="png",
                ),
            ),
            bounds=(0.0, 0.0, 1.0, 1.0),
        )

        with (
            patch("app.main.list_map_sets", return_value=[{"id": "demo", "name": "Demo", "description": "", "vrtPath": "/data/demo.vrt", "dtmLayers": [{"path": "/data/demo.gpkg"}]}]),
            patch("app.main.inspect_sources", return_value=(source,)),
        ):
            response = self.client.get("/api/v1/openapi.json")

        self.assertEqual(response.status_code, 200)
        schema = response.json()
        self.assertIn("/api/v1/hat/sets", schema["paths"])
        self.assertNotIn("/api/hat/sets", schema["paths"])

    def test_set_payload_is_4326_only(self) -> None:
        matrix = TileMatrixMetadata(
            zoom_level=0,
            matrix_width=1,
            matrix_height=1,
            tile_width=256,
            tile_height=256,
            pixel_x_size=1.0,
            pixel_y_size=1.0,
            min_tile_col=0,
            max_tile_col=0,
            min_tile_row=0,
            max_tile_row=0,
        )
        source = GpkgSourceMetadata(
            path="/data/demo.gpkg",
            tables=(
                TileTableMetadata(
                    table_name="terrain",
                    identifier="terrain",
                    srs_id=4326,
                    supported_crs="EPSG:4326",
                    bounds=(0.0, 0.0, 1.0, 1.0),
                    tile_matrices=(matrix,),
                    mime_type="image/png",
                    file_extension="png",
                ),
            ),
            bounds=(0.0, 0.0, 1.0, 1.0),
        )

        with (
            patch("app.main.get_map_set", return_value={"id": "demo", "name": "Demo", "description": "", "vrtPath": "/data/demo.vrt", "dtmLayers": [{"path": "/data/demo.gpkg"}]}),
            patch("app.main.inspect_sources", return_value=(source,)),
        ):
            response = self.client.get("/api/v1/hat/sets/demo")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["tileMatrixSet"], "EPSG:4326")
        self.assertEqual(payload["tileUrlTemplate"], payload["tileUrlTemplate4326"])
        self.assertNotIn("bounds3857", payload)
        self.assertEqual(payload["sources"][0]["bounds"], [0.0, 0.0, 1.0, 1.0])

    def test_tile_route_uses_single_renderer(self) -> None:
        with (
            patch("app.main.get_map_set", return_value={"id": "demo", "name": "Demo", "description": "", "vrtPath": "/data/demo.vrt", "dtmLayers": [{"path": "/data/demo.gpkg"}]}),
            patch("app.main.inspect_vrt_source_paths", return_value=("/data/demo.gpkg",)),
            patch("app.main.render_terrain_rgb_tile", return_value=b"png-bytes") as render_mock,
        ):
            response = self.client.get("/api/v1/hat/sets/demo/tiles/0/0/0.png")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"png-bytes")
        render_mock.assert_called_once()

    def test_tiles_outside_first_gpkg_boundary_fall_back_to_vrt(self) -> None:
        first_matrix = TileMatrixMetadata(
            zoom_level=0,
            matrix_width=1,
            matrix_height=1,
            tile_width=256,
            tile_height=256,
            pixel_x_size=1.0,
            pixel_y_size=1.0,
            min_tile_col=0,
            max_tile_col=0,
            min_tile_row=0,
            max_tile_row=0,
        )
        first_source = GpkgSourceMetadata(
            path="/data/first.gpkg",
            tables=(
                TileTableMetadata(
                    table_name="terrain",
                    identifier="terrain",
                    srs_id=4326,
                    supported_crs="EPSG:4326",
                    bounds=(-10.0, -10.0, -5.0, -5.0),
                    tile_matrices=(first_matrix,),
                    mime_type="image/png",
                    file_extension="png",
                ),
            ),
            bounds=(-10.0, -10.0, -5.0, -5.0),
        )

        with (
            patch("app.services.terrain_rendering.inspect_gpkg_source", return_value=first_source),
            patch("app.services.terrain_rendering._read_exact_tile_for_sources") as exact_mock,
            patch("app.services.terrain_rendering._read_vrt_tile", return_value=b"vrt-bytes") as vrt_mock,
        ):
            tile = render_terrain_rgb_tile(("/data/first.gpkg", "/data/second.gpkg"), "/data/demo.vrt", 0, 0, 0)

        self.assertEqual(tile, b"vrt-bytes")
        exact_mock.assert_not_called()
        vrt_mock.assert_called_once()


if __name__ == "__main__":
    unittest.main()
