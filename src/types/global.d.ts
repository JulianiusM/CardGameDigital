/* Browser globals retained only for the progressively enhanced account pages. */
export {};

declare global {
    interface Window {
        PartyCardGame: {
            init?: () => void;
        };
    }
}
