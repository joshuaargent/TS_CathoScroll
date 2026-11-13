import type { CapacitorConfig } from '@capacitor/cli';

const nativeBundle = process.env.CATHOSCROLL_NATIVE_BUNDLE === '1';
const serverUrl = process.env.CAPACITOR_SERVER_URL || 'https://cathoscroll.vercel.app';
const parsedServerUrl = new URL(serverUrl);

if (parsedServerUrl.protocol !== 'https:') {
  throw new Error('CAPACITOR_SERVER_URL must use HTTPS.');
}

const config: CapacitorConfig = {
  appId: 'com.joshuaargent.cathoscroll',
  appName: 'CathoScroll',
  webDir: nativeBundle ? 'build/native' : 'www',
  ...(!nativeBundle && {
    server: {
      url: parsedServerUrl.toString(),
      cleartext: false,
      errorPath: 'index.html',
    },
  }),
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      launchFadeOutDuration: 250,
      backgroundColor: '#FAF7F2',
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
      androidIsEncryption: nativeBundle,
    },
  },
};

export default config;
