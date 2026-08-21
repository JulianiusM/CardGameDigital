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

import type {Request} from 'express';

/**
 * Persist the current session state before continuing the response cycle.
 *
 * Express-session writes changes asynchronously via the configured store.
 * When a handler mutates the session (for example after logging in or out)
 * and immediately redirects, the follow-up request can occasionally arrive
 * before the store has finished writing.  By explicitly awaiting `save()` we
 * make sure the session data has been committed and is visible to the next
 * HTTP request.
 */
export function persistSession(session: Request['session']): Promise<void> {
    return new Promise((resolve, reject) => {
        const save = session.save?.bind(session);
        if (!save) {
            resolve();
            return;
        }

        save((err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

