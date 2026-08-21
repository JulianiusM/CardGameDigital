/**
 * Helpers for reusable date range modals.
 * Centralizes min/max handling, form population, and submit lifecycle so modules
 * can remain lean and focused on their domain logic.
 */

import {hideSpinner, showSpinner} from './ui-helpers';
import {showInlineAlert} from './alerts';

export interface DateRangeBounds {
    min?: string;
    max?: string;
}

export interface DateRangeValues {
    registrationId: string;
    arrivalDate: string;
    departureDate: string;
}

export interface DateRangeModalBindings {
    modal: HTMLElement;
    form: HTMLFormElement;
    bounds?: DateRangeBounds;
    alertContainer?: HTMLElement;
}

function applyBounds(form: HTMLFormElement, bounds?: DateRangeBounds): void {
    const arrival = form.querySelector<HTMLInputElement>('input[name="arrivalDate"]');
    const departure = form.querySelector<HTMLInputElement>('input[name="departureDate"]');
    if (!arrival || !departure) return;

    if (bounds?.min) {
        arrival.min = bounds.min;
        departure.min = bounds.min;
    }
    if (bounds?.max) {
        arrival.max = bounds.max;
        departure.max = bounds.max;
    }
}

export function populateDateRangeModal(bindings: DateRangeModalBindings, values: DateRangeValues): void {
    applyBounds(bindings.form, bindings.bounds);

    const arrival = bindings.form.querySelector<HTMLInputElement>('input[name="arrivalDate"]');
    const departure = bindings.form.querySelector<HTMLInputElement>('input[name="departureDate"]');
    const registration = bindings.form.querySelector<HTMLInputElement>('input[name="registrationId"]');
    if (!arrival || !departure || !registration) return;

    arrival.value = values.arrivalDate;
    departure.value = values.departureDate;
    registration.value = values.registrationId;

    (window as any).bootstrap?.Modal.getOrCreateInstance(bindings.modal)?.show();
}

export function readDateRangePayload(form: HTMLFormElement): DateRangeValues | null {
    const arrival = form.querySelector<HTMLInputElement>('input[name="arrivalDate"]')?.value?.trim() || '';
    const departure = form.querySelector<HTMLInputElement>('input[name="departureDate"]')?.value?.trim() || '';
    const registrationId = form.querySelector<HTMLInputElement>('input[name="registrationId"]')?.value?.trim();
    if (!registrationId || !arrival || !departure) return null;
    return {arrivalDate: arrival, departureDate: departure, registrationId};
}

export async function submitDateRangeModal(
    bindings: DateRangeModalBindings,
    submitAction: (payload: DateRangeValues) => Promise<void>,
    options?: {
        successMessage?: string;
        onSuccess?: () => Promise<void> | void;
    },
): Promise<void> {
    const payload = readDateRangePayload(bindings.form);
    if (!payload) return;

    const submitBtn = bindings.form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submitBtn) showSpinner(submitBtn);
    try {
        await submitAction(payload);
        if (options?.onSuccess) await options.onSuccess();
        showInlineAlert('success', options?.successMessage || 'Dates updated', bindings.alertContainer);
        (window as any).bootstrap?.Modal.getOrCreateInstance(bindings.modal)?.hide();
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Update failed.';
        showInlineAlert('error', message, bindings.alertContainer);
    } finally {
        if (submitBtn) hideSpinner(submitBtn);
    }
}
