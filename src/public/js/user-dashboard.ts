/**
 * User dashboard module
 * Simple module for user dashboard functionality
 */

import {setCurrentNavLocation} from './core/navigation';
import {loadPerms} from './core/permissions';
import {initEntityOverview} from "./modules/entity-cards-overview";


/**
 * Initialize user dashboard
 */
export function init(): void {
    setCurrentNavLocation();
    loadPerms();
    //initEntityLists();
    initEntityOverview("#participationLists")
    initEntityOverview("#entityLists")
}

// Expose to global scope when running in a browser; keeping this guarded makes imports safe in tests.
if (typeof window !== 'undefined') {
    if (!window.Surveyor) window.Surveyor = {};
    window.Surveyor.init = init;
}
