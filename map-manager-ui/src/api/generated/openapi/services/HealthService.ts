/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class HealthService {
  /**
   * Health check
   * @returns any Service is healthy
   * @throws ApiError
   */
  public static getHealth(): CancelablePromise<{
    ok: boolean;
  }> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/health',
    });
  }
}
