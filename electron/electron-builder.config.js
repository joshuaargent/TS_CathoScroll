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
    // CathoScroll is distributed unsigned; macOS update notices link to the
    // website so users can download and install the new DMG manually.
    identity: null,
    notarize: false,
    artifactName: '${productName}-${version}-${arch}.${ext}',
    // The sqlite package ships both macOS prebuilds in each architecture's
    // package tree. They are identical across the x64 and arm64 staging apps,
    // so preserve the shared arm64 prebuild instead of trying to lipo-merge it.
    x64ArchFiles: '**/better-sqlite3-multiple-ciphers/prebuilds/darwin-arm64.node',
  },
  publish: {
    provider: 'github',
    owner: 'joshuaargent',
    repo: 'TS_CathoScroll',
  },
};
