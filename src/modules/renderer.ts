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

import {Response} from 'express';
import type {Severity} from "../types/ErrorTypes";

export type Status = Severity | "success" | undefined;

//Wrapper for rendering pages
export default {
    //Default rendering
    render,

    //Message rendering
    renderError,
    renderErrorData,
    renderInfo,
    renderInfoData,
    renderSuccess,
    renderSuccessData,
    renderMessage,
    renderMessageData,

    //Page rendering
    renderWithError,
    renderWithErrorData,
    renderWithInfo,
    renderWithInfoData,
    renderWithSuccess,
    renderWithSuccessData,
    renderWithMessage,
    renderWithMessageData,
    renderWithData,

    //Default response
    respond,

    //Formatted response
    respondWithErrorJson,
    respondWithErrorDataJson,
    respondWithInfoJson,
    respondWithInfoDataJson,
    respondWithSuccessJson,
    respondWithSuccessDataJson,
    respondStructuredJson,
    respondWithJson
}


/*-----------[BEGINN>MESSAGE]----------*/

/*-----------[ERROR]----------*/

function renderError(res: Response, message?: string) {
    renderErrorData(res, message);
}

function renderErrorData(res: Response, message?: string, data?: any) {
    renderMessageData(res, "error", message, data);
}

/*-----------[INFO]----------*/

function renderInfo(res: Response, message?: string) {
    renderInfoData(res, message);
}

function renderInfoData(res: Response, message?: string, data?: any) {
    renderMessageData(res, "info", message, data);
}

/*-----------[SUCCESS]----------*/

function renderSuccess(res: Response, message?: string) {
    renderSuccessData(res, message);
}

function renderSuccessData(res: Response, message?: string, data?: any) {
    renderMessageData(res, "success", message, data);
}

/*-----------[GENERIC]----------*/

function renderMessage(res: Response, status: Status, message?: string) {
    renderMessageData(res, status, message);
}

function renderMessageData(res: Response, status: Status, message?: string, data?: any) {
    renderWithMessageData(res, "message", status, message, data);
}

/*-----------[END>MESSAGE]----------*/


/*-----------[BEGINN>PAGE]----------*/

/*-----------[ERROR]----------*/

function renderWithError(res: Response, page: string, message?: string) {
    renderWithErrorData(res, page, message);
}

function renderWithErrorData(res: Response, page: string, message?: string, data?: any) {
    renderWithMessageData(res, page, "error", message, data);
}

/*-----------[INFO]----------*/

function renderWithInfo(res: Response, page: string, message?: string) {
    renderWithInfoData(res, page, message);
}

function renderWithInfoData(res: Response, page: string, message?: string, data?: any) {
    renderWithMessageData(res, page, "info", message, data);
}

/*-----------[SUCCESS]----------*/

function renderWithSuccess(res: Response, page: string, message?: string) {
    renderWithSuccessData(res, page, message);
}

function renderWithSuccessData(res: Response, page: string, message?: string, data?: any) {
    renderWithMessageData(res, page, "success", message, data);
}

/*-----------[GENERIC]----------*/

function render(res: Response, page: string) {
    renderWithData(res, page);
}

function renderWithData(res: Response, page: string, data?: any) {
    renderWithMessageData(res, page, undefined, undefined, data);
}

function renderWithMessage(res: Response, page: string, status: Status, message?: string) {
    renderWithMessageData(res, page, status, message);
}

function renderWithMessageData(res: Response, page: string, status: Status, message?: string, data?: any) {
    res.render(page, {
        status: status,
        message: message,
        data: data
    });
}

/*-----------[END>PAGE]----------*/


/*-----------[BEGINN>APIRESPONSES]----------*/

/*-----------[ERROR]----------*/

function respondWithErrorJson(res: Response, message?: string) {
    respondWithErrorDataJson(res, message, null);
}

function respondWithErrorDataJson(res: Response, message?: string, data?: any) {
    respondStructuredJson(res, "error", message, data);
}

/*-----------[INFO]----------*/

function respondWithInfoJson(res: Response, message?: string) {
    respondWithInfoDataJson(res, message, null);
}

function respondWithInfoDataJson(res: Response, message?: string, data?: any) {
    respondStructuredJson(res, "info", message, data);
}

/*-----------[SUCCESS]----------*/

function respondWithSuccessJson(res: Response, message?: string) {
    respondWithSuccessDataJson(res, message, null);
}

function respondWithSuccessDataJson(res: Response, message?: string, data?: any) {
    respondStructuredJson(res, "success", message, data);
}

/*-----------[GENERIC]----------*/

function respondStructuredJson(res: Response, status: Status, message?: string, data?: any) {
    respondWithJson(res, {
        status: status,
        message: message,
        data: data
    });
}

function respondWithJson(res: Response, data?: any) {
    res.header("Content-Type", 'application/json');
    respond(res, JSON.stringify(data));
}

function respond(res: Response, data?: any) {
    res.end(data);
}

/*-----------[END>APIRESPONSES]----------*/
