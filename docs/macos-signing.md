# macOS signing and notarisation

CathoScroll is distributed directly from GitHub, not through the Mac App Store. Release builds therefore use an **Apple Developer ID Application** certificate and Apple's notarisation service.

## 1. Enrol in the Apple Developer Program

1. Sign in with your Apple Account at https://developer.apple.com/programs/enroll/.
2. Enrol as an **Individual**. An organisation account is not required for CathoScroll.
3. Complete identity verification and pay Apple's annual membership fee.
4. Wait until the membership is active.

The free Apple Developer account does not issue Developer ID distribution certificates.

## 2. Create a Developer ID Application certificate

1. Open https://developer.apple.com/account/resources/certificates/list.
2. Choose **Certificates** and add a new certificate.
3. Under **Software**, select **Developer ID Application**. Do not select Apple Distribution or Developer ID Installer.
4. Create a Certificate Signing Request (CSR), upload it, and download the issued certificate.

On a Mac, create the CSR in Keychain Access using Certificate Assistant → Request a Certificate From a Certificate Authority. Save the CSR to disk and keep the corresponding private key safe.

If you do not have a Mac, OpenSSL can generate the private key and CSR on Windows (keep the private key private):

```powershell
openssl req -new -newkey rsa:2048 -nodes -keyout DeveloperIDApplication.key -out CertificateSigningRequest.certSigningRequest -subj "/CN=Joshua Argent"
```

Upload `CertificateSigningRequest.certSigningRequest` to Apple's certificate portal and download the resulting `.cer` file. Convert it and package it with the matching private key:

```powershell
openssl x509 -inform DER -in developerID_application.cer -out developerID_application.pem
openssl pkcs12 -export -inkey DeveloperIDApplication.key -in developerID_application.pem -out DeveloperIDApplication.p12 -name "Developer ID Application"
```

OpenSSL will ask you to set an export password. Keep that password; it becomes the GitHub secret `MAC_CSC_KEY_PASSWORD`.

If Apple's downloaded certificate is already PEM encoded, omit `-inform DER` from the conversion command. Never upload or commit the private key, CSR private key material, or P12 file to the repository.

## 3. Create an App Store Connect API key for notarisation

The API key is used only to authenticate CI with Apple's notarisation service; CathoScroll is not being submitted to the Mac App Store.

1. Open https://appstoreconnect.apple.com/access/integrations/api.
2. Create a **Team Key** with the **Developer** role.
3. Download the `.p8` key immediately. Apple only lets you download it once.
4. Record the **Key ID** and **Issuer ID** shown by App Store Connect.

## 4. Add GitHub Actions secrets

In the GitHub repository, open Settings → Secrets and variables → Actions → New repository secret.

Create these five secrets:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | Base64-encoded `DeveloperIDApplication.p12` |
| `MAC_CSC_KEY_PASSWORD` | The password used when exporting the P12 |
| `APPLE_API_KEY` | Base64-encoded contents of the App Store Connect `.p8` file |
| `APPLE_API_KEY_ID` | The API Key ID |
| `APPLE_API_ISSUER` | The Issuer ID |

On Windows PowerShell, copy each file's Base64 content to the clipboard:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\DeveloperIDApplication.p12")) | Set-Clipboard
```

Repeat for the `.p8` file, changing the path. Paste the clipboard contents into the corresponding GitHub secret. Do not put any of these values in source code, workflow files, issues, or chat.

## 5. What the release workflow does

The single universal macOS release build includes both Intel and Apple Silicon architectures. The workflow:

- imports the Developer ID certificate using electron-builder's `CSC_LINK` and `CSC_KEY_PASSWORD`;
- signs the application with the Developer ID Application identity;
- notarises the signed app using the App Store Connect API key;
- staples Apple's notarisation ticket where supported;
- publishes the DMG and ZIP update artefacts to the GitHub release.

The workflow fails before packaging if any required secret is missing. Signing is mandatory when the notarisation API key is present. Pull-request build checks do not receive signing secrets and continue to build unsigned test artefacts.

## 6. Verify the first signed release

After the first release, download the DMG on a Mac and verify that macOS opens it without an unidentified-developer override. In Terminal, the app bundle can also be checked with:

```bash
spctl --assess --type execute --verbose "/Applications/CathoScroll.app"
```
