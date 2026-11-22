import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('2.4.0 native release versions remain aligned across package, lockfiles and Android', async () => {
  const [root, rootLock, electron, electronLock, gradle, releaseWorkflow] = await Promise.all([
    read('../package.json').then(JSON.parse),
    read('../package-lock.json').then(JSON.parse),
    read('../electron/package.json').then(JSON.parse),
    read('../electron/package-lock.json').then(JSON.parse),
    read('../android/app/build.gradle'),
    read('../.github/workflows/desktop-release.yml'),
  ]);

  assert.equal(root.version, '2.4.0');
  assert.equal(rootLock.version, '2.4.0');
  assert.equal(rootLock.packages[''].version, '2.4.0');
  assert.equal(electron.version, '2.4.0');
  assert.equal(electronLock.version, '2.4.0');
  assert.equal(electronLock.packages[''].version, '2.4.0');
  assert.match(gradle, /versionCode \(System\.getenv\("ANDROID_VERSION_CODE"\)\?\.toInteger\(\) \?: 2004000\)/);
  assert.match(gradle, /versionName \(System\.getenv\("CATHOSCROLL_VERSION"\)\?\.replaceFirst\(\/\^v\/, ''\) \?: "2\.4\.0"\)/);
  assert.match(releaseWorkflow, /root\.version !== tagVersion/);
  assert.match(releaseWorkflow, /electron\.version !== tagVersion/);
  assert.match(releaseWorkflow, /major \* 1000000 \+ minor \* 1000 \+ patch/);
  assert.match(releaseWorkflow, /ANDROID_VERSION_CODE=\$android_version_code.*GITHUB_ENV/);
  assert.doesNotMatch(releaseWorkflow, /ANDROID_VERSION_CODE: \$\{\{ env\.ANDROID_VERSION_CODE \}\}/);
  assert.match(releaseWorkflow, /CathoScroll-\$\{RELEASE_TAG#v\}\.apk/);
  assert.match(releaseWorkflow, /git merge-base --is-ancestor/);
  assert.match(releaseWorkflow, /fetch-depth: 0/);
  assert.match(releaseWorkflow, /refs\/remotes\/origin\/main/);
});

test('desktop updates use automatic delivery only on supported package formats', async () => {
  const source = await read('../electron/main.ts');

  assert.match(source, /process\.platform === 'darwin' \|\| \(process\.platform === 'linux' && !process\.env\.APPIMAGE\)/);
  assert.match(source, /void checkForManualUpdate\(\)/);
  assert.match(source, /autoUpdater\.autoDownload = true/);
  assert.match(source, /autoUpdater\.autoInstallOnAppQuit = true/);
  assert.match(source, /autoUpdater\.checkForUpdatesAndNotify\(\)/);
  assert.match(source, /DOWNLOAD_PAGE_URL/);
});

test('Android update checker only offers a matching stable APK from the latest published release', async () => {
  const [checker, activity, manifest] = await Promise.all([
    read('../android/app/src/main/java/com/joshuaargent/cathoscroll/AndroidUpdateChecker.java'),
    read('../android/app/src/main/java/com/joshuaargent/cathoscroll/MainActivity.java'),
    read('../android/app/src/main/AndroidManifest.xml'),
  ]);

  assert.match(checker, /releases\/latest/);
  assert.match(checker, /release\.optBoolean\("draft", false\)/);
  assert.match(checker, /release\.optBoolean\("prerelease", false\)/);
  assert.match(checker, /CathoScroll-\" \+ latestVersion \+ \"\.apk/);
  assert.match(checker, /candidateUrl\.startsWith\(RELEASE_DOWNLOAD_PREFIX\)/);
  assert.match(checker, /candidateUrl\.endsWith\("\/" \+ expectedAssetName\)/);
  assert.match(checker, /isNewerVersion\(latestVersion, currentVersion\)/);
  assert.match(checker, /DownloadManager/);
  assert.match(checker, /ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.match(activity, /AndroidUpdateChecker\.checkForUpdates\(this\)/);
  assert.match(activity, /AndroidUpdateChecker\.resumePendingInstall\(this\)/);
  assert.match(manifest, /REQUEST_INSTALL_PACKAGES/);
});

test('release notes document platform-specific update behaviour and manual acceptance', async () => {
  const notes = await read('../docs/releases/2.4.0.md');
  assert.match(notes, /Windows and Linux AppImage Electron builds use `electron-updater`/);
  assert.match(notes, /Linux DEB installations and unsigned macOS builds use a version-check notice/);
  assert.match(notes, /Verify Android update detection, download, resume and installation on a physical device/);
});
