/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class DtMsService {
  /**
   * List shared DTMs
   * @returns any Shared DTM GeoPackages
   * @throws ApiError
   */
  public static listSharedDtms(): CancelablePromise<{
    files: Array<{
      relativePath: string;
      absolutePath: string;
      fileName: string;
      size: number;
      modifiedAt: string;
      /**
       * Map sets that reference this file
       */
      referencedBySets: Array<string>;
      /**
       * Whether the file lives inside a managed set folder
       */
      managedBySet: boolean;
    }>;
  }> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/dtms',
    });
  }
  /**
   * Rename a shared DTM
   * @returns any Updated file metadata
   * @throws ApiError
   */
  public static renameSharedDtm({
    requestBody,
  }: {
    requestBody: {
      relativePath: string;
      nextFileName: string;
    },
  }): CancelablePromise<{
    file: {
      relativePath: string;
      absolutePath: string;
      fileName: string;
      size: number;
      modifiedAt: string;
      /**
       * Map sets that reference this file
       */
      referencedBySets: Array<string>;
      /**
       * Whether the file lives inside a managed set folder
       */
      managedBySet: boolean;
    };
  }> {
    return __request(OpenAPI, {
      method: 'PATCH',
      url: '/api/dtms',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Validation error`,
      },
    });
  }
  /**
   * Delete a shared DTM
   * @returns void
   * @throws ApiError
   */
  public static deleteSharedDtm({
    path,
  }: {
    path: string,
  }): CancelablePromise<void> {
    return __request(OpenAPI, {
      method: 'DELETE',
      url: '/api/dtms',
      query: {
        'path': path,
      },
      errors: {
        400: `Validation error`,
      },
    });
  }
  /**
   * Upload a shared DTM
   * @returns any Uploaded file metadata
   * @throws ApiError
   */
  public static uploadSharedDtm({
    formData,
  }: {
    formData: {
      dtm: Blob;
    },
  }): CancelablePromise<{
    file: {
      relativePath: string;
      absolutePath: string;
      fileName: string;
      size: number;
      modifiedAt: string;
      /**
       * Map sets that reference this file
       */
      referencedBySets: Array<string>;
      /**
       * Whether the file lives inside a managed set folder
       */
      managedBySet: boolean;
    };
  }> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/api/dtms/upload',
      formData: formData,
      mediaType: 'multipart/form-data',
      errors: {
        400: `Validation error`,
      },
    });
  }
  /**
   * Download a shared DTM
   * @returns any Binary file download
   * @throws ApiError
   */
  public static downloadSharedDtm({
    path,
  }: {
    path: string,
  }): CancelablePromise<any> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/dtms/download',
      query: {
        'path': path,
      },
      errors: {
        400: `Validation error`,
      },
    });
  }
}
