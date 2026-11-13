import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.joshuaargent.cathoscroll',
  appName: 'CathoScroll',
  webDir: 'build/native',
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      launchFadeOutDuration: 250,
      backgroundColor: '#FAF7F2',
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
      androidIsEncryption: true,
    },
  },
};

export default config;
