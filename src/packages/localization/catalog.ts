export type MessageParameters = Record<string, string | number>;

export type EmailCatalog = {
    signature: string;
    activation: { subject: string; body: string };
    passwordReset: { subject: string; body: string };
    accountDeleted: { subject: string; body: string };
};

export type ServerMessageCatalog = {
    messages: Record<MessageKey, string>;
    email: EmailCatalog;
};
import type { MessageKey } from "./keys";
