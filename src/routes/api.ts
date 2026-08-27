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
import { ExpectedError } from "../modules/lib/errors";
import { MESSAGE_KEYS } from "../packages/localization/keys";

import settings from "../modules/settings";
import { roomAccessConfiguration } from "../modules/roomAccessUrls";
import { installationServerId } from "../modules/installationIdentity";
import {
    API_BASE_PATH,
    localDiscoveryStatus,
    localNetworkDiscoveryCapability,
} from "../modules/localDiscoveryState";
import { roomDisplayBootstrapCapability } from "../modules/roomCreateProtection";
import couchRouter from "./api/couch";
import roomsRouter from "./api/rooms";
import gameProfilesRouter from "./api/gameProfiles";
import accountRouter from "./api/account";
import groupsRouter from "./api/groups";
import gameSettingsRouter from "./api/gameSettings";
import helpRouter from "./api/help";
import catalogRouter from "./api/catalog";
import cardPolicyRouter from "./api/cardPolicy";

const router = express.Router();

router.get("/v1/server-info", (_req, res) =>
    res.json({
        version: 1,
        serverId: installationServerId(),
        displayName: settings.value.serverDisplayName,
        deploymentMode: settings.value.deploymentMode,
        publicRuntimeSecurity: settings.value.publicRuntimeSecurity,
        authenticationAvailable: settings.value.authMode === "account",
        protocolVersions: [2],
        roomCapacity: {
            maximumParticipants: settings.value.roomMaximumParticipants,
            maximumPlayers: settings.value.roomMaximumPlayers,
        },
        roomAccess: roomAccessConfiguration(settings.value),
        capabilities: {
            localNetworkDiscovery: localNetworkDiscoveryCapability(),
            displayBootstrapRoomCreation: roomDisplayBootstrapCapability(),
        },
        localNetworkDiscovery: {
            advertising: localDiscoveryStatus().advertising,
            serviceType: settings.value.mdnsServiceType,
            txtVersion: localDiscoveryStatus().txtVersion,
        },
        endpoints: {
            apiBasePath: API_BASE_PATH,
            webSocketPath: settings.value.webSocketPath,
            roomJoinPathTemplate: settings.value.roomJoinPathTemplate,
        },
    }),
);
router.use("/v1/couch", couchRouter);
router.use("/v1/rooms", roomsRouter);
router.use("/v1/game-profiles", gameProfilesRouter);
router.use("/v1/account", accountRouter);
router.use("/v1/groups", groupsRouter);
router.use("/v1/game-settings", gameSettingsRouter);
router.use("/v1/help", helpRouter);
router.use("/v1/catalog", catalogRouter);
router.use("/v1/card-policy", cardPolicyRouter);

// catch 404 and forward to error handler
router.use(function (req: express.Request, res: express.Response, next: NextFunction) {
    next(new ExpectedError(MESSAGE_KEYS.REQUEST_NOT_FOUND, "error", 404));
});
router.use(wrapErrorApi);

export default router;
