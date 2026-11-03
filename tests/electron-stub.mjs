// Remplace le module electron dans les tests unitaires (Node pur).
export const shell = { openExternal: async () => undefined };
export const app = { getPath: () => process.env.MINUTE_USERDATA || '.', isPackaged: false, on: () => undefined };
export const session = { defaultSession: { webRequest: { onBeforeRequest: () => undefined } } };
export const safeStorage = { isEncryptionAvailable: () => false };
export const dialog = {};
export const clipboard = { write: () => undefined };
export class ClipboardItem {}
export default { shell, app, session, safeStorage, dialog, clipboard, ClipboardItem };
