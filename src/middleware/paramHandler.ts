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

import {NextFunction, Request, Response, Router} from "express";
import {asyncHandler, asyncParamHandler} from "../modules/lib/asyncHandler";
import {APIError, ExpectedError} from "../modules/lib/errors";
import type {GuestFlowDb} from "../types/UserTypes";

export function apiParamHandler(param: string, router: Router, getById: GuestFlowDb['getById'], entityType: string) {
    handleParam(param, router, getById, entityType, new APIError(`${entityType} not found`, {}, 404));
}

export function paramHandler(param: string, router: Router, getById: GuestFlowDb['getById'], entityType: string) {
    handleParam(param, router, getById, entityType, new ExpectedError(`${entityType} not found`, 'error', 404));
}

export function queryHandler(param: string, router: Router, getById: GuestFlowDb['getById'], entityName: string, error?: Error) {
    router.use(asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
        await handle(req.query[param], getById, entityName, req, res, next, error)
    }));
}

export function createPathQueryHandler(param: string, router: Router, getById: GuestFlowDb['getById'], entityName: string, error?: Error) {
    router.use(asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
            if (!req.path.endsWith("/create") && !req.path.endsWith("/duplicate")) {
                return next();
            }

            return await handle(req.query[param], getById, entityName, req, res, next, error)
        }
    ));
}

export function handleParam(param: string, router: Router, getById: GuestFlowDb['getById'], entityName: string, error?: Error) {
    router.param(param, asyncParamHandler(async (req: Request, res: Response, next: NextFunction, id: any) =>
        await handle(id, getById, entityName, req, res, next, error)
    ));
}

async function handle(
    id: any,
    getById: GuestFlowDb['getById'],
    entityName: string,
    req: Request,
    res: Response,
    next: NextFunction,
    error?: Error,
) {
    let entity = undefined;
    if (id !== undefined) {
        entity = await getById(id);
    }
    if (!entity) {
        if (error) throw error;
        // No error --> Optional resource
        return next();
    }
    req.resource = req.resource || {};
    req.resource[entityName] = entity;
    if (entity.event) {
        req.resource['event'] = entity.event;
    }
    return next();
}