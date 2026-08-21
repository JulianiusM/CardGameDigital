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

// src/types/global.d.ts
import type {ActivitySlot} from '../modules/database/entities/activity/ActivitySlot';
import type {PackingItem} from '../modules/database/entities/packing/PackingItem';
import type {PermBundle} from './PermissionTypes';

export {};

declare global {
    interface Window {
        Surveyor: {
            init?: () => void;
            // Add more functions/properties if needed
            // Entity IDs from server
            entityId?: string;
            eventId?: string;

            // Prefilled data from server
            prefilledItems?: Partial<PackingItem>[];
            prefilledSlots?: Record<string, Partial<ActivitySlot>[]>;
            prefilledCombinations?: { weekday: string; nth_week?: string }[];

            // Serialized permissions bundle
            rawPermissions?: string;
            permissions?: PermBundle;

            allRoles?: RoleSummary[];
            slotRoles?: string;
        };

        // Bootstrap types
        bootstrap?: {
            Modal: {
                getOrCreateInstance(element: HTMLElement): { show(): void; hide(): void };
                getInstance(element: HTMLElement): { show(): void; hide(): void } | null;
                new(element: HTMLElement): { show(): void; hide(): void };
            };
        };

    }
}
