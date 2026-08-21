/**
 * Core password validation utilities
 * Provides password strength checking and validation
 */

/**
 * Update element class state based on validation
 * @param object jQuery element
 * @param validated Whether validation passed
 * @param validatedClass Class to add when valid
 * @param invalidatedClass Class to add when invalid
 */
export function refreshState(
    object: JQuery<HTMLElement>,
    validated: boolean,
    validatedClass: string,
    invalidatedClass: string
): void {
    if (validated && !object.hasClass(validatedClass)) {
        if (object.hasClass(invalidatedClass)) {
            object.removeClass(invalidatedClass);
        }
        object.addClass(validatedClass);
    } else if (!validated && !object.hasClass(invalidatedClass)) {
        if (object.hasClass(validatedClass)) {
            object.removeClass(validatedClass);
        }
        object.addClass(invalidatedClass);
    }
}

/**
 * Test if password meets requirements
 * @param password Password to test
 * @returns True if password is valid
 */
export function isPasswordValid(password?: string): boolean {
    return !!password && password.length >= 8 && /[a-z,A-Z]/g.test(password) && /\d/g.test(password);
}

/**
 * Test if password repeat matches original
 * @param password Original password
 * @param passwordRepeat Repeated password
 * @returns True if passwords match
 */
export function isPasswordRepeatValid(password?: string, passwordRepeat?: string): boolean {
    return password === passwordRepeat;
}

/**
 * Generate password requirements feedback HTML using Bootstrap styling
 * @param hasEight Has 8+ characters
 * @param hasLetter Has at least one letter
 * @param hasDigit Has at least one digit
 * @returns HTML string for feedback
 */
export function generatePasswordFeedback(hasEight: boolean, hasLetter: boolean, hasDigit: boolean): string {
    const criteria = [
        {met: hasEight, text: 'At least 8 characters'},
        {met: hasLetter, text: 'At least one letter'},
        {met: hasDigit, text: 'At least one digit'}
    ];

    const items = criteria.map(c => {
        const icon = c.met
            ? '<i class="bi bi-check-circle-fill text-success"></i>'
            : '<i class="bi bi-x-circle text-danger"></i>';
        const textClass = c.met ? 'text-success' : 'text-danger';
        return `<li class="small ${textClass}">${icon} ${c.text}</li>`;
    }).join('');

    return `<ul class="list-unstyled mb-0 mt-1">${items}</ul>`;
}

/**
 * Verify password meets requirements and update UI with Bootstrap validation
 * @param passwordObj Password input jQuery object
 * @param infoObj Info display jQuery object
 */
export function verifyPassword(passwordObj: JQuery<HTMLInputElement>, infoObj: JQuery<HTMLElement>): void {
    const password = passwordObj.val() ?? '';
    const isEightChars = password.length >= 8;
    const hasLetter = /[a-z,A-Z]/g.test(password);
    const hasDigit = /\d/g.test(password);
    const isValid = isPasswordValid(password);

    // Update feedback display
    infoObj.html(generatePasswordFeedback(isEightChars, hasLetter, hasDigit));

    // Update Bootstrap validation classes
    if (password.length > 0) {
        refreshState(passwordObj, isValid, "is-valid", "is-invalid");
    } else {
        // Remove validation classes when empty
        passwordObj.removeClass("is-valid is-invalid");
    }
}

/**
 * Check if passwords match and update UI
 * @param passwordObj Password input jQuery object
 * @param passwordRepeatObj Password repeat input jQuery object
 * @param repeatInfoObj Repeat info display jQuery object
 */
export function matchPassword(
    passwordObj: JQuery<HTMLInputElement>,
    passwordRepeatObj: JQuery<HTMLInputElement>,
    repeatInfoObj: JQuery<HTMLElement>
): void {
    // Hide or show "Passwords do not match"
    refreshState(repeatInfoObj, isPasswordRepeatValid(passwordObj.val(), passwordRepeatObj.val()), "invisible", "visible");

    // Show field status using bootstrap
    refreshState(passwordRepeatObj, isPasswordRepeatValid(passwordObj.val(), passwordRepeatObj.val()), "is-valid", "is-invalid");
}

/**
 * Remove tooltip if password is valid
 * @param passwordObj Password input jQuery object
 * @param infoObj Info display jQuery object
 */
export function removeTooltip(passwordObj: JQuery<HTMLInputElement>, infoObj: JQuery<HTMLElement>): void {
    if (isPasswordValid(passwordObj.val() ?? '')) {
        infoObj.empty();
    }
}

/**
 * Validate passwords on submit
 * @param event Form submit event
 * @param passwordObj Password input jQuery object
 * @param passwordRepeatObj Password repeat input jQuery object
 * @param infoObj Password info display jQuery object
 * @param passwordRepeatInfoObj Password repeat info display jQuery object
 */
export function validate(
    event: Event,
    passwordObj: JQuery<HTMLInputElement>,
    passwordRepeatObj: JQuery<HTMLInputElement>,
    infoObj: JQuery<HTMLElement>,
    passwordRepeatInfoObj: JQuery<HTMLElement>
): void {
    const password = passwordObj.val();
    const passwordRepeat = passwordRepeatObj.val();

    if (!isPasswordValid(password) || !isPasswordRepeatValid(password, passwordRepeat)) {
        event.preventDefault();
        event.stopPropagation();
        alert("Please check that both the password and the password repetition are valid!");
        verifyPassword(passwordObj, infoObj);
        removeTooltip(passwordObj, infoObj);
        matchPassword(passwordObj, passwordRepeatObj, passwordRepeatInfoObj);
    }
}
