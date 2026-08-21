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

import express, {NextFunction} from 'express';
import createError from "http-errors";
import {handleValidationError, wrapErrorApi} from '../middleware/validationErrorHandler';

import activityApiRouter from './api/activity';
import driverApiRouter from './api/drivers';
import eventApiRouter from './api/event';
import packingApiRouter from './api/packing';
import surveyApiRouter from './api/survey';
import userApiRouter from './api/users';

const router = express.Router();

router.use('/activity', activityApiRouter);
router.use('/packing', packingApiRouter);
router.use('/drivers', driverApiRouter);
router.use('/event', eventApiRouter);
router.use('/users', userApiRouter);
router.use('/survey', surveyApiRouter);

router.use(handleValidationError);
// catch 404 and forward to error handler
router.use(function (req: express.Request, res: express.Response, next: NextFunction) {
    next(createError(404));
});
router.use(wrapErrorApi);

export default router;