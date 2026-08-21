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

/**
 * Shared TypeORM transformers for common data type conversions.
 */

import {formatAmount, toAmount} from "../lib/util";

/**
 * Currency transformer for decimal columns.
 * Converts numeric values to formatted decimal strings (2 decimal places) for database storage
 * and back to numbers for application use.
 */
export const currencyTransformer = {
    to: (value: number | string) => formatAmount(toAmount(value)),
    from: Number,
};
