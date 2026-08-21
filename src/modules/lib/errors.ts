/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// lib/errors.js
// Custom error types for centralized error handling in Express routes

import type {Severity} from "../../types/ErrorTypes";

/**
 * Represents a validation or business logic error that should render
 * a specific template with associated data.
 *
 * @property {string} template - The view/template to render on error.
 * @property {object} data - Contextual data to pass back to the template.
 */
export class ValidationError extends Error {
    data: object;
    template: string;

    /**
     * @param {string} template - Template name or identifier for rendering.
     * @param {string} message - Error message to display.
     * @param {object} data - Data to re-populate the form or context.
     * @param {ErrorOptions} options - ErrorOptions
     */
    constructor(template: string, message: string, data: object = {}, options?: ErrorOptions) {
        super(message, options);
        this.name = 'ValidationError';
        this.template = template;
        this.data = data;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Represents a validation or business logic error that should return
 * some data as JSON
 *
 * @property {object} data - Contextual data to pass back to the client.
 * @property {number} status - HTTP status
 */
export class APIError extends Error {
    data: object;
    status: number;

    /**
     * @param {string} message - Error message to display.
     * @param {object} data - Data to re-populate the form or context.
     * @param {number} status - HTTP status
     * @param {ErrorOptions} options - ErrorOptions
     */
    constructor(message: string, data: object = {}, status: number = 500, options?: ErrorOptions) {
        super(message, options);
        this.name = 'APIError';
        this.data = data;
        this.status = status;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

/**
 * Represents a validation or business logic error that should render
 * a non-critical error message
 *
 * @property {Severity} severity - Message severity (error - info - success)
 * @property {object} data - Contextual data to pass back to the client.
 * @property {number} status - HTTP status
 * @param {ErrorOptions} options - ErrorOptions
 */
export class ExpectedError extends Error {
    data: object;
    severity: Severity;
    status: number;

    /**
     * @param {string} message - Error message to display.
     * @param {Severity} severity - Message severity (error - info - success)
     * @param {number} status - HTTP status
     * @param {object} data - Data to re-populate the form or context.
     * @param {ErrorOptions} options - ErrorOptions
     */
    constructor(message: string, severity: Severity = 'error', status: number = 400, data: object = {}, options?: ErrorOptions) {
        super(message, options);
        this.name = 'ExpectedError';
        this.severity = severity;
        this.data = data;
        this.status = status;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}

export class InternalError extends Error {
    //Dummy for now
}