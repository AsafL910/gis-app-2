/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CatalogLayersResponseSchema } from '../models/CatalogLayersResponseSchema';
import type { CatalogResponseSchema } from '../models/CatalogResponseSchema';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class CatalogService {
  /**
   * List Sets
   * @returns CatalogResponseSchema Successful Response
   * @throws ApiError
   */
  public static listSetsApiV1SetsGet(): CancelablePromise<CatalogResponseSchema> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/sets',
    });
  }
  /**
   * List Layers For Set
   * @returns CatalogLayersResponseSchema Successful Response
   * @throws ApiError
   */
  public static listLayersForSetApiV1SetsSetIdLayersGet({
    setId,
  }: {
    setId: string,
  }): CancelablePromise<CatalogLayersResponseSchema> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/sets/{set_id}/layers',
      path: {
        'set_id': setId,
      },
      errors: {
        422: `Validation Error`,
      },
    });
  }
  /**
   * List Layers
   * @returns CatalogLayersResponseSchema Successful Response
   * @throws ApiError
   */
  public static listLayersApiV1LayersGet(): CancelablePromise<CatalogLayersResponseSchema> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/v1/layers',
    });
  }
}
