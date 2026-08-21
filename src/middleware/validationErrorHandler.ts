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

/*
 * middlewares/validationErrorHandler.js
 */
import {NextFunction, Request, Response} from "express";
import {validationResult} from 'express-validator';
import {APIError} from "../modules/lib/errors";
import renderer from '../modules/renderer';

export function handleValidationError(req: Request, res: Response, next: NextFunction) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return renderer.respondWithErrorJson(res, errors.array().map((e: any) => e.msg).join(', '));
    }
    next();
}

export function wrapErrorApi(err: Error & {
    data?: object,
    status?: number
}, req: Request, res: Response, next: NextFunction) {
    throw new APIError(err.message, err.data ?? {data: err.cause}, err.status ?? 500, {cause: err});
}