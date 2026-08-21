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
import * as helpController from '../controller/helpController';
import {asyncHandler} from '../modules/lib/asyncHandler';

const router = express.Router();

// GET /help - Help index (shows README)
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const data = helpController.fetchHelpIndex();
    res.render('help', data);
}));

// GET /help/:docName - Specific help document
router.get('/:docName', asyncHandler(async (req: Request, res: Response) => {
    const docName = req.params.docName as string;
    const data = helpController.fetchHelpDoc(docName);
    res.render('help', data);
}));

export default router;
