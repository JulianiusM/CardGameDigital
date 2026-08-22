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

import express, { NextFunction } from "express";
import { wrapErrorApi } from "../middleware/validationErrorHandler";

import settings from "../modules/settings";
import couchRouter from "./api/couch";
import roomsRouter from "./api/rooms";
import gameProfilesRouter from "./api/gameProfiles";
import accountRouter from "./api/account";
import groupsRouter from "./api/groups";
import gameSettingsRouter from "./api/gameSettings";
import helpRouter from "./api/help";

const router = express.Router();

router.get("/v1/server-info", (_req, res) =>
    res.json({
        version: 1,
        deploymentMode: settings.value.deploymentMode,
        protocolVersions: [1],
    }),
);
router.use("/v1/couch", couchRouter);
router.use("/v1/rooms", roomsRouter);
router.use("/v1/game-profiles", gameProfilesRouter);
router.use("/v1/account", accountRouter);
router.use("/v1/groups", groupsRouter);
router.use("/v1/game-settings", gameSettingsRouter);
router.use("/v1/help", helpRouter);

// catch 404 and forward to error handler
router.use(function (req: express.Request, res: express.Response, next: NextFunction) {
    next(Object.assign(new Error("API endpoint not found"), { status: 404 }));
});
router.use(wrapErrorApi);

export default router;
