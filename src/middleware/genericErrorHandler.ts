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

import {NextFunction, Request, Response} from "express";

import {APIError, ExpectedError, ValidationError} from "../modules/lib/errors";
import renderer from "../modules/renderer";

export function handleGenericError(err: Error, req: Request, res: Response, next: NextFunction) {
    const status: number = (err as any).status || 500;
    if (status >= 500) console.error(err);
    res.status(status);

    if (err instanceof ExpectedError) {
        return renderer.renderMessageData(
            res,
            err.severity,
            err.message,
            err.data
        )
    }

    if (err instanceof APIError) {
        // API --> JSON
        return renderer.respondWithErrorDataJson(
            res,
            err.message,
            err.data
        )
    }

    console.log(err);

    if (err instanceof ValidationError) {
        // form validation or business errors with template/data
        return renderer.renderWithErrorData(
            res,
            err.template,
            err.message,
            err.data
        );
    }

    // set locals, only providing error in development
    res.locals.message = err.message;
    res.locals.code = status;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    renderer.render(res, 'error');
}