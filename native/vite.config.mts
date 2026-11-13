import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const envDir = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, envDir, ['NEXT_PUBLIC_']);
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      throw new Error(
        'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before building the native app.'
      );
    }
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    if (url.protocol !== 'https:') throw new Error('The native Supabase URL must use HTTPS.');
  }
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    envDir,
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
  };
});
