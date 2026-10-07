import { createAuth } from './auth.factory.js';
// src/auth/auth.cli.ts


// CLI-only: schema generation reads options and never queries the database.
export const auth = createAuth({} as any);