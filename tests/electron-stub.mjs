// Remplace le module electron dans les tests unitaires (Node pur).
export const shell = { openExternal: async () => undefined };
export const app = { getPath: () => '.', isPackaged: false };
export const session = { defaultSession: { webRequest: { onBeforeRequest: () => undefined } } };
export default { shell, app, session };
