/**
 * Password verification module
 * Handles password validation UI and form submission
 */

import {setCurrentNavLocation} from './core/navigation';
import {matchPassword, removeTooltip, validate, verifyPassword} from './core/password-validation';
import {loadPerms} from './core/permissions';

/**
 * Register password verification events
 */
function registerEvents(): void {
    // Events regarding the password field
    $("#password").on("input", function () {
        verifyPassword($("#password"), $("#password-info"));
        matchPassword($("#password"), $("#password_repeat"), $("#password_repeat-info"));
    }).on('focusin', function () {
        verifyPassword($("#password"), $("#password-info"));
        matchPassword($("#password"), $("#password_repeat"), $("#password_repeat-info"));
    }).on('focusout', function () {
        removeTooltip($("#password"), $("#password-info"));
    });

    // Events regarding password repeat field
    $("#password_repeat").on("input", function () {
        matchPassword($("#password"), $("#password_repeat"), $("#password_repeat-info"));
    });

    // Events regarding submit button
    $("#form").on("submit", function (event: any) {
        validate(event, $("#password"), $("#password_repeat"), $("#password-info"), $("#password_repeat-info"));
    });
}

/**
 * Initialize password verification module
 */
export function init(): void {
    registerEvents();
    setCurrentNavLocation();
    loadPerms();
}

// Expose to global scope when running in a browser; keeping this guarded makes imports safe in tests.
if (typeof window !== 'undefined') {
    if (!window.Surveyor) window.Surveyor = {};
    window.Surveyor.init = init;
}
