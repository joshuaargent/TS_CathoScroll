import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('..', import.meta.url)),
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  base: './',
  resolve: {
    alias: {
      'next/link': fileURLToPath(new URL('./link.tsx', import.meta.url)),
      '@/lib/supabase/client': fileURLToPath(new URL('./supabase.ts', import.meta.url)),
      '@': fileURLToPath(new URL('../src', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../build/native', import.meta.url)),
    emptyOutDir: true,
  },
});
