/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class MapsService {
  /**
   * List shared maps
   * @returns any Shared GeoPackages
   * @throws ApiError
   */
  public static listSharedGpkgs(): CancelablePromise<{
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
      url: '/api/maps',
    });
  }
  /**
   * Rename a shared map
   * @returns any Updated file metadata
   * @throws ApiError
   */
  public static renameSharedGpkg({
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
      url: '/api/maps',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Validation error`,
      },
    });
  }
  /**
   * Delete a shared map
   * @returns void
   * @throws ApiError
   */
  public static deleteSharedGpkg({
    path,
  }: {
    path: string,
  }): CancelablePromise<void> {
    return __request(OpenAPI, {
      method: 'DELETE',
      url: '/api/maps',
      query: {
        'path': path,
      },
      errors: {
        400: `Validation error`,
      },
    });
  }
  /**
   * Upload a shared map
   * @returns any Uploaded file metadata
   * @throws ApiError
   */
  public static uploadSharedGpkg({
    formData,
  }: {
    formData: {
      gpkg: Blob;
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
      url: '/api/maps/upload',
      formData: formData,
      mediaType: 'multipart/form-data',
      errors: {
        400: `Validation error`,
      },
    });
  }
  /**
   * Download a shared map
   * @returns any Binary file download
   * @throws ApiError
   */
  public static downloadSharedGpkg({
    path,
  }: {
    path: string,
  }): CancelablePromise<any> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/maps/download',
      query: {
        'path': path,
      },
      errors: {
        400: `Validation error`,
      },
    });
  }
}
