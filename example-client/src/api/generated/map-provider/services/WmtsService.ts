/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class WmtsService {
  /**
   * Wmts Capabilities
   * @returns any Successful Response
   * @throws ApiError
   */
  public static wmtsCapabilitiesApiV1WmtsWmtsCapabilitiesXmlGet(): CancelablePromise<any> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/wmts/WMTSCapabilities.xml',
    });
  }
  /**
   * Wmts Kvp
   * @returns any Successful Response
   * @throws ApiError
   */
  public static wmtsKvpApiV1WmtsGet(): CancelablePromise<any> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/wmts',
    });
  }
  /**
   * Wmts Rest Tile
   * @returns any Successful Response
   * @throws ApiError
   */
  public static wmtsRestTileApiV1WmtsIdentifierTileMatrixSetTileMatrixTileRowTileColExtGet({
    identifier,
    tileMatrixSet,
    tileMatrix,
    tileRow,
    tileCol,
    ext,
  }: {
    identifier: string,
    tileMatrixSet: string,
    tileMatrix: number,
    tileRow: number,
    tileCol: number,
    ext: string,
  }): CancelablePromise<any> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/wmts/{identifier}/{tile_matrix_set}/{tile_matrix}/{tile_row}/{tile_col}.{ext}',
      path: {
        'identifier': identifier,
        'tile_matrix_set': tileMatrixSet,
        'tile_matrix': tileMatrix,
        'tile_row': tileRow,
        'tile_col': tileCol,
        'ext': ext,
      },
      errors: {
        422: `Validation Error`,
      },
    });
  }
  /**
   * Wmts Capabilities By Set
   * @returns any Successful Response
   * @throws ApiError
   */
  public static wmtsCapabilitiesBySetApiV1WmtsSetsSetIdWmtsCapabilitiesXmlGet({
    setId,
  }: {
    setId: string,
  }): CancelablePromise<any> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/wmts/sets/{set_id}/WMTSCapabilities.xml',
      path: {
        'set_id': setId,
      },
      errors: {
        422: `Validation Error`,
      },
    });
  }
  /**
   * Wmts Kvp By Set
   * @returns any Successful Response
   * @throws ApiError
   */
  public static wmtsKvpBySetApiV1WmtsSetsSetIdGet({
    setId,
  }: {
    setId: string,
  }): CancelablePromise<any> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/wmts/sets/{set_id}',
      path: {
        'set_id': setId,
      },
      errors: {
        422: `Validation Error`,
      },
    });
  }
  /**
   * Wmts Rest Tile By Set
   * @returns any Successful Response
   * @throws ApiError
   */
  public static wmtsRestTileBySetApiV1WmtsSetsSetIdIdentifierTileMatrixSetTileMatrixTileRowTileColExtGet({
    setId,
    identifier,
    tileMatrixSet,
    tileMatrix,
    tileRow,
    tileCol,
    ext,
  }: {
    setId: string,
    identifier: string,
    tileMatrixSet: string,
    tileMatrix: number,
    tileRow: number,
    tileCol: number,
    ext: string,
  }): CancelablePromise<any> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/wmts/sets/{set_id}/{identifier}/{tile_matrix_set}/{tile_matrix}/{tile_row}/{tile_col}.{ext}',
      path: {
        'set_id': setId,
        'identifier': identifier,
        'tile_matrix_set': tileMatrixSet,
        'tile_matrix': tileMatrix,
        'tile_row': tileRow,
        'tile_col': tileCol,
        'ext': ext,
      },
      errors: {
        422: `Validation Error`,
      },
    });
  }
}
