/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.joshuaargent.cathoscroll',
  productName: 'CathoScroll',
  directories: {
    output: 'dist',
    buildResources: 'assets',
  },
  asarUnpack: ['**/*.node'],
  files: [
    'build/**/*',
    'app/**/*',
    'generated/**/*',
    // `assets` is also the electron-builder `buildResources` directory, whose
    // contents are NOT packaged by default. Include it explicitly so the
    // splash screen and other runtime assets ship in the app.
    'assets/**/*',
    'package.json',
    // Platform runtime + plugins, prepared by `capacitor-electron vendor`.
    { from: 'vendor/node_modules', to: 'node_modules' },
  ],
  win: {
    icon: 'assets/icon.ico',
    target: ['nsis'],
  },
  nsis: {
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  linux: {
    icon: '../assets/logo.png',
    category: 'Education',
    maintainer: 'Joshua Argent <argentjackjoshua@gmail.com>',
    target: ['AppImage', 'deb'],
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  mac: {
    icon: 'assets/icon.icns',
    category: 'public.app-category.education',
    target: ['dmg', 'zip'],
    // Release builds provide Developer ID signing and App Store Connect
    // notarisation credentials. Pull-request builds intentionally omit them.
    notarize: Boolean(process.env.APPLE_API_KEY),
    artifactName: '${productName}-${version}-${arch}.${ext}',
  },
  publish: {
    provider: 'github',
    owner: 'joshuaargent',
    repo: 'TS_CathoScroll',
  },
};
