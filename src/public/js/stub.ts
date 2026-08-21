/**
 * Stub module - Default initialization for pages without custom JS
 * Provides basic navigation and entity list functionality
 */

import {setCurrentNavLocation} from "./core/navigation";
import {loadPerms} from './core/permissions';

/**
 * Initialize stub module
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
}

// Expose to global scope when running in a browser; keeping this guarded makes imports safe in tests.
if (typeof window !== 'undefined') {
    if (!window.Surveyor) window.Surveyor = {};
    window.Surveyor.init = init;
}
