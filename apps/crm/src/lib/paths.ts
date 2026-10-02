/**
 * The CRM's base path, exported on its own so client components can import it
 * without pulling in the server-only config module.
 *
 * Must stay in sync with `basePath` in next.config.mjs; both read the same
 * NEXT_PUBLIC_CRM_BASE_PATH, which Next inlines into the client bundle because
 * of the NEXT_PUBLIC_ prefix.
 */
export const CRM_BASE_PATH = process.env.NEXT_PUBLIC_CRM_BASE_PATH || "/crm";
