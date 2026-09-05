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

import crypto from "node:crypto";

// Funktion zur Generierung eines einzigartigen Tokens
export function generateUniqueToken() {
    return crypto.randomBytes(32).toString("hex");
}

export function jsonReplacer(_key: string, value: unknown): unknown {
    return value instanceof Map ? { dataType: "Map", value: [...value.entries()] } : value;
}

export function mergeUnique<T>(
    left: readonly T[],
    right: readonly T[],
    equals: (a: T, b: T) => boolean = Object.is,
): T[] {
    return [...left, ...right.filter((item) => !left.some((existing) => equals(item, existing)))];
}

export function normalizeToArray<T>(value: T | readonly T[] | null | undefined): readonly T[] {
    if (value == null) return [];
    return Array.isArray(value) ? value : [value as T];
}
