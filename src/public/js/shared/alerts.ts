/**
 * Shared alert/notification system
 * Provides consistent in-page alerts across the application
 */

/**
 * Show an inline alert message
 * @param status Alert type (success, info, error)
 * @param message Message to display
 * @param container Optional container element (defaults to #liveAlerts)
 */
export function showInlineAlert(
    status: 'success' | 'info' | 'error',
    message: string,
    container?: HTMLElement
): void {
    const alertBox = container || document.getElementById('liveAlerts');
    if (!alertBox) return;

    const cls = {
        success: 'alert-success',
        info: 'alert-info',
        error: 'alert-danger',
    }[status] || 'alert-info';

    const alert = document.createElement('div');
    alert.classList.add('alert', cls, 'alert-dismissible', 'fade', 'show');
    alert.role = 'alert';
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>`

    alertBox.appendChild(alert);
    alert.focus();
    alertBox.scrollIntoView(true)
}
