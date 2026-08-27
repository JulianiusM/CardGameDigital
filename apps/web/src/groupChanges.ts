import { randomUuidV4 } from "./randomUuid";

const GROUP_CHANGE_KEY = "party-game:groups-changed";

export function announceGroupChange(): void {
    localStorage.setItem(GROUP_CHANGE_KEY, `${Date.now()}:${randomUuidV4()}`);
}

export function subscribeToGroupChanges(listener: () => void): () => void {
    const handleStorage = (event: StorageEvent) => {
        if (event.key === GROUP_CHANGE_KEY) listener();
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
}
