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

import express, {Request, Response} from 'express';
import rateLimit from "express-rate-limit";
import * as userController from "../../controller/userController";
import {createUserSearchApiRouter} from "../../middleware/adminApiFactory";
import {asyncHandler} from "../../modules/lib/asyncHandler";
import renderer from '../../modules/renderer';

const app = express.Router();

const searchLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    limit: 10,                  // 10 searches / 10 min per IP
    standardHeaders: true,
    legacyHeaders: false,
});

app.post('/guest/email', searchLimiter, asyncHandler(async (req: Request, res: Response) => {
    if (!req.body?.email || !await userController.hasGuestAccountForEmail(req.body.email)) {
        renderer.respondWithErrorJson(res, "none");
        return;
    }

    renderer.respondWithSuccessJson(res, "present");
}));

app.use(createUserSearchApiRouter());

export default app;