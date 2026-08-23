import { writable } from "svelte/store";

export type NotificationKind = "info" | "success" | "error";
export type AppNotification = {
    id: number;
    message: string;
    kind: NotificationKind;
    duration: number;
};

let nextId = 0;
export const notification = writable<AppNotification | null>(null);

export function showNotification(
    message: string,
    kind: NotificationKind = "info",
    duration = 5000,
): void {
    notification.set({ id: ++nextId, message, kind, duration });
}

export function dismissNotification(id?: number): void {
    notification.update((current) => (!id || current?.id === id ? null : current));
}
