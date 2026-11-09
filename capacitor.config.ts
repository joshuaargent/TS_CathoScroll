import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAPACITOR_SERVER_URL || 'https://cathoscroll.vercel.app';
const parsedServerUrl = new URL(serverUrl);

if (parsedServerUrl.protocol !== 'https:') {
  throw new Error('CAPACITOR_SERVER_URL must use HTTPS.');
}

const config: CapacitorConfig = {
  appId: 'com.joshuaargent.cathoscroll',
  appName: 'CathoScroll',
  webDir: 'www',
  server: {
    url: parsedServerUrl.toString(),
    cleartext: false,
    errorPath: 'index.html',
  },
};

export default config;
