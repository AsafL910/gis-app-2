from fastapi import APIRouter, Request
from fastapi.responses import Response

from src.config import API_PREFIX, PUBLIC_BASE_URL
from src.services.wmts import build_wmts_capabilities_xml, render_wmts_tile


router = APIRouter(tags=["WMTS"])


def _base_url(request: Request) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    return str(request.base_url).rstrip("/")


def _parse_wmts_request(request: Request) -> tuple[str, str]:
    params = {key.lower(): value for key, value in request.query_params.items()}
    service = params.get("service", "").upper()
    action = params.get("request", "").lower()

    if service and service != "WMTS":
        raise ValueError("Unsupported service")

    return service, action


@router.get(f"{API_PREFIX}/wmts/WMTSCapabilities.xml")
def wmts_capabilities(request: Request):
    xml = build_wmts_capabilities_xml(_base_url(request))
    return Response(content=xml, media_type="application/xml")


@router.get(f"{API_PREFIX}/wmts")
def wmts_kvp(request: Request):
    try:
        _service, action = _parse_wmts_request(request)
    except ValueError:
        return Response(content="Unsupported service", status_code=400, media_type="text/plain")

    params = {key.lower(): value for key, value in request.query_params.items()}
    if action == "getcapabilities":
        xml = build_wmts_capabilities_xml(_base_url(request))
        return Response(content=xml, media_type="application/xml")

    if action == "gettile":
        tile, mime_type = render_wmts_tile(
            identifier=params.get("layer", ""),
            tile_matrix_set=params.get("tilematrixset", ""),
            tile_matrix=int(params.get("tilematrix", "0")),
            tile_row=int(params.get("tilerow", "0")),
            tile_col=int(params.get("tilecol", "0")),
        )
        return Response(content=tile, media_type=mime_type)

    return Response(content="Unsupported WMTS request", status_code=400, media_type="text/plain")


@router.get(f"{API_PREFIX}/wmts/{{identifier}}/{{tile_matrix_set}}/{{tile_matrix}}/{{tile_row}}/{{tile_col}}.{{ext}}")
def wmts_rest_tile(
    identifier: str,
    tile_matrix_set: str,
    tile_matrix: int,
    tile_row: int,
    tile_col: int,
    ext: str,
):
    tile, mime_type = render_wmts_tile(identifier, tile_matrix_set, tile_matrix, tile_row, tile_col)
    return Response(content=tile, media_type=mime_type)


@router.get(f"{API_PREFIX}/wmts/sets/{{set_id}}/WMTSCapabilities.xml")
def wmts_capabilities_by_set(set_id: str, request: Request):
    xml = build_wmts_capabilities_xml(_base_url(request), set_id)
    return Response(content=xml, media_type="application/xml")


@router.get(f"{API_PREFIX}/wmts/sets/{{set_id}}")
def wmts_kvp_by_set(set_id: str, request: Request):
    try:
        _service, action = _parse_wmts_request(request)
    except ValueError:
        return Response(content="Unsupported service", status_code=400, media_type="text/plain")

    params = {key.lower(): value for key, value in request.query_params.items()}
    if action == "getcapabilities":
        xml = build_wmts_capabilities_xml(_base_url(request), set_id)
        return Response(content=xml, media_type="application/xml")

    if action == "gettile":
        tile, mime_type = render_wmts_tile(
            identifier=params.get("layer", ""),
            tile_matrix_set=params.get("tilematrixset", ""),
            tile_matrix=int(params.get("tilematrix", "0")),
            tile_row=int(params.get("tilerow", "0")),
            tile_col=int(params.get("tilecol", "0")),
            set_id=set_id,
        )
        return Response(content=tile, media_type=mime_type)

    return Response(content="Unsupported WMTS request", status_code=400, media_type="text/plain")


@router.get(f"{API_PREFIX}/wmts/sets/{{set_id}}/{{identifier}}/{{tile_matrix_set}}/{{tile_matrix}}/{{tile_row}}/{{tile_col}}.{{ext}}")
def wmts_rest_tile_by_set(
    set_id: str,
    identifier: str,
    tile_matrix_set: str,
    tile_matrix: int,
    tile_row: int,
    tile_col: int,
    ext: str,
):
    tile, mime_type = render_wmts_tile(identifier, tile_matrix_set, tile_matrix, tile_row, tile_col, set_id)
    return Response(content=tile, media_type=mime_type)
