import { app, safeStorage } from 'electron';
import { createCathoSecureStorage } from './secure-storage-core.mjs';

export const CathoSecureStorage = createCathoSecureStorage({ app, safeStorage });
