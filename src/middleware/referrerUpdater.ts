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
import settings from "../modules/settings";

export function addNextQuery(localPart: string, notStartsWith?: string) {
    return (req: Request, res: Response, nxt: NextFunction) => {
        let next = req.query.next;
        if (typeof next === "string" && !next.startsWith("/")) {
            // Not a relative path --> remove
            return res.redirect(localPart);
        }
        let ref = req.headers.referer;
        if (!next && ref?.startsWith(settings.value.rootUrl)) {
            ref = ref.replace(settings.value.rootUrl, "");
            if (!ref.startsWith("/")) {
                ref = "/" + ref;
            }
            if (ref != "/" && !ref.startsWith(localPart) && (!notStartsWith || !ref.startsWith(notStartsWith))) {
                return res.redirect(`${localPart}?next=${encodeURIComponent(ref)}`);
            }
        }
        nxt();
    }
}