/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class HatService {
  /**
   * List Sets
   * @returns any Successful Response
   * @throws ApiError
   */
  public static listSetsApiV1HatSetsGet(): CancelablePromise<Record<string, Array<Record<string, any>>>> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/hat/sets',
    });
  }
  /**
   * Get Set
   * @returns any Successful Response
   * @throws ApiError
   */
  public static getSetApiV1HatSetsSetIdGet({
    setId,
  }: {
    setId: string,
  }): CancelablePromise<Record<string, any>> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/hat/sets/{set_id}',
      path: {
        'set_id': setId,
      },
      errors: {
        422: `Validation Error`,
      },
    });
  }
  /**
   * Terrain Tile
   * @returns any Successful Response
   * @throws ApiError
   */
  public static terrainTileApiV1HatSetsSetIdTilesZXYPngGet({
    setId,
    z,
    x,
    y,
  }: {
    setId: string,
    z: number,
    x: number,
    y: number,
  }): CancelablePromise<any> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/hat/sets/{set_id}/tiles/{z}/{x}/{y}.png',
      path: {
        'set_id': setId,
        'z': z,
        'x': x,
        'y': y,
      },
      errors: {
        422: `Validation Error`,
      },
    });
  }
}
