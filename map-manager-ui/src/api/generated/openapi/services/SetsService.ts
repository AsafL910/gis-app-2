/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class SetsService {
  /**
   * List map sets
   * @returns any Map sets
   * @throws ApiError
   */
  public static listSets(): CancelablePromise<{
    sets: Array<{
      id: string;
      name: string;
      description?: string;
      /**
       * Uploaded or linked map files
       */
      maps: Array<{
        id: string;
        kind: 'map' | 'dtm';
        originalName: string;
        storedName: string;
        relativePath: string;
        absolutePath: string;
        mimeType: string;
        size: number;
        createdAt: string;
      }>;
      /**
       * Ordered DTM layers
       */
      dtmLayers: Array<{
        id: string;
        kind: 'map' | 'dtm';
        originalName: string;
        storedName: string;
        relativePath: string;
        absolutePath: string;
        mimeType: string;
        size: number;
        createdAt: string;
        /**
         * Layer order in the generated VRT
         */
        priority: number;
      }>;
      vrtPath: string;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    return __request(OpenAPI, {
      method: 'GET',
      url: '/api/sets',
    });
  }
  /**
   * Create a map set
   * @returns any Created map set
   * @throws ApiError
   */
  public static createSet({
    formData,
  }: {
    formData: {
      name: string;
      description?: string;
      /**
       * One or more uploaded map files
       */
      maps?: Array<Blob>;
      /**
       * One or more uploaded DTM files
       */
      dtms?: Array<Blob>;
      /**
       * Shared map file paths to copy into the set
       */
      selectedMapPaths?: Array<string>;
      /**
       * Shared DTM file paths to copy into the set
       */
      selectedDtmPaths?: Array<string>;
      /**
       * Optional ordering of uploaded and selected DTM files
       */
      dtmSelectionOrder?: Array<{
        source: 'upload' | 'existing';
        relativePath?: string;
      }>;
    },
  }): CancelablePromise<{
    id: string;
    name: string;
    description?: string;
    /**
     * Uploaded or linked map files
     */
    maps: Array<{
      id: string;
      kind: 'map' | 'dtm';
      originalName: string;
      storedName: string;
      relativePath: string;
      absolutePath: string;
      mimeType: string;
      size: number;
      createdAt: string;
    }>;
    /**
     * Ordered DTM layers
     */
    dtmLayers: Array<{
      id: string;
      kind: 'map' | 'dtm';
      originalName: string;
      storedName: string;
      relativePath: string;
      absolutePath: string;
      mimeType: string;
      size: number;
      createdAt: string;
      /**
       * Layer order in the generated VRT
       */
      priority: number;
    }>;
    vrtPath: string;
    createdAt: string;
    updatedAt: string;
  }> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/api/sets',
      formData: formData,
      mediaType: 'multipart/form-data',
      errors: {
        400: `Validation error`,
      },
    });
  }
  /**
   * Append assets to a map set
   * @returns any Updated map set
   * @throws ApiError
   */
  public static appendAssetsToSet({
    id,
    formData,
  }: {
    id: string,
    formData: {
      /**
       * One or more uploaded map files
       */
      maps?: Array<Blob>;
      /**
       * One or more uploaded DTM files
       */
      dtms?: Array<Blob>;
      /**
       * Shared map file paths to copy into the set
       */
      selectedMapPaths?: Array<string>;
      /**
       * Shared DTM file paths to copy into the set
       */
      selectedDtmPaths?: Array<string>;
      /**
       * Optional ordering of uploaded and selected DTM files
       */
      dtmSelectionOrder?: Array<{
        source: 'upload' | 'existing';
        relativePath?: string;
      }>;
    },
  }): CancelablePromise<{
    id: string;
    name: string;
    description?: string;
    /**
     * Uploaded or linked map files
     */
    maps: Array<{
      id: string;
      kind: 'map' | 'dtm';
      originalName: string;
      storedName: string;
      relativePath: string;
      absolutePath: string;
      mimeType: string;
      size: number;
      createdAt: string;
    }>;
    /**
     * Ordered DTM layers
     */
    dtmLayers: Array<{
      id: string;
      kind: 'map' | 'dtm';
      originalName: string;
      storedName: string;
      relativePath: string;
      absolutePath: string;
      mimeType: string;
      size: number;
      createdAt: string;
      /**
       * Layer order in the generated VRT
       */
      priority: number;
    }>;
    vrtPath: string;
    createdAt: string;
    updatedAt: string;
  }> {
    return __request(OpenAPI, {
      method: 'POST',
      url: '/api/sets/{id}/assets',
      path: {
        'id': id,
      },
      formData: formData,
      mediaType: 'multipart/form-data',
      errors: {
        400: `Validation error`,
      },
    });
  }
  /**
   * Reorder the DTM layers for a set
   * @returns any Updated map set
   * @throws ApiError
   */
  public static reorderDtmLayers({
    id,
    requestBody,
  }: {
    id: string,
    requestBody: {
      /**
       * Full desired ordering of DTM layer IDs
       */
      dtmIds: Array<string>;
    },
  }): CancelablePromise<{
    id: string;
    name: string;
    description?: string;
    /**
     * Uploaded or linked map files
     */
    maps: Array<{
      id: string;
      kind: 'map' | 'dtm';
      originalName: string;
      storedName: string;
      relativePath: string;
      absolutePath: string;
      mimeType: string;
      size: number;
      createdAt: string;
    }>;
    /**
     * Ordered DTM layers
     */
    dtmLayers: Array<{
      id: string;
      kind: 'map' | 'dtm';
      originalName: string;
      storedName: string;
      relativePath: string;
      absolutePath: string;
      mimeType: string;
      size: number;
      createdAt: string;
      /**
       * Layer order in the generated VRT
       */
      priority: number;
    }>;
    vrtPath: string;
    createdAt: string;
    updatedAt: string;
  }> {
    return __request(OpenAPI, {
      method: 'PUT',
      url: '/api/sets/{id}/dtm-order',
      path: {
        'id': id,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Validation error`,
      },
    });
  }
  /**
   * Delete a map set
   * @returns void
   * @throws ApiError
   */
  public static deleteSet({
    id,
  }: {
    id: string,
  }): CancelablePromise<void> {
    return __request(OpenAPI, {
      method: 'DELETE',
      url: '/api/sets/{id}',
      path: {
        'id': id,
      },
      errors: {
        404: `Set not found`,
      },
    });
  }
}
