package com.joshuaargent.cathoscroll;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class AndroidUpdateChecker {
    private static final String LATEST_RELEASE_URL =
        "https://api.github.com/repos/joshuaargent/TS_CathoScroll/releases/latest";
    private static final String RELEASE_DOWNLOAD_PREFIX =
        "https://github.com/joshuaargent/TS_CathoScroll/releases/download/";
    private static final String APK_MIME_TYPE = "application/vnd.android.package-archive";
    private static final String PREFS_NAME = "cathoscroll_updates";
    private static final String PENDING_DOWNLOAD_ID = "pending_download_id";
    private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

    private AndroidUpdateChecker() {}

    public static void checkForUpdates(Activity activity) {
        EXECUTOR.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(LATEST_RELEASE_URL).openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(10_000);
                connection.setReadTimeout(10_000);
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "CathoScroll-Android");

                int responseCode = connection.getResponseCode();
                if (responseCode != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException("GitHub returned HTTP " + responseCode + " while checking for Android updates.");
                }

                StringBuilder responseBody = new StringBuilder();
                try (InputStream input = connection.getInputStream();
                     BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) responseBody.append(line);
                }

                JSONObject release = new JSONObject(responseBody.toString());
                if (release.optBoolean("draft", false) || release.optBoolean("prerelease", false)) return;

                String latestVersion = release.optString("tag_name", "").replaceFirst("^v", "");
                String currentVersion = BuildConfig.VERSION_NAME;
                if (!isStableVersion(latestVersion) || !isStableVersion(currentVersion)
                    || !isNewerVersion(latestVersion, currentVersion)) return;

                JSONArray assets = release.optJSONArray("assets");
                if (assets == null) throw new IllegalStateException("The latest GitHub release has no assets list.");

                String expectedAssetName = "CathoScroll-" + latestVersion + ".apk";
                String downloadUrl = null;
                for (int index = 0; index < assets.length(); index++) {
                    JSONObject asset = assets.optJSONObject(index);
                    if (asset == null || !expectedAssetName.equals(asset.optString("name"))) continue;

                    String candidateUrl = asset.optString("browser_download_url", "");
                    long assetSize = asset.optLong("size", 0L);
                    if (candidateUrl.startsWith(RELEASE_DOWNLOAD_PREFIX)
                        && candidateUrl.endsWith("/" + expectedAssetName) && assetSize > 0L) {
                        downloadUrl = candidateUrl;
                        break;
                    }
                }
                if (downloadUrl == null) {
                    throw new IllegalStateException("The latest GitHub release does not contain the expected signed Android APK.");
                }

                String finalDownloadUrl = downloadUrl;
                activity.runOnUiThread(() -> {
                    if (activity.isFinishing() || activity.isDestroyed()) return;
                    showUpdateDialog(activity, currentVersion, latestVersion, finalDownloadUrl);
                });
            } catch (Exception error) {
                android.util.Log.w("CathoScrollUpdates", "Unable to check for Android updates.", error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    public static void handleDownloadCompleted(Activity activity, Intent intent) {
        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
        long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
        SharedPreferences preferences = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (completedId == -1L || completedId != preferences.getLong(PENDING_DOWNLOAD_ID, -1L)) return;

        DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(completedId))) {
            if (cursor == null || !cursor.moveToFirst()) {
                clearPendingDownload(preferences);
                showToast(activity, "The CathoScroll update download could not be found.");
                return;
            }
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status == DownloadManager.STATUS_FAILED) {
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                clearPendingDownload(preferences);
                showToast(activity, "The CathoScroll update download failed (error " + reason + ").");
                return;
            }
            if (status != DownloadManager.STATUS_SUCCESSFUL) return;
        }
        openDownloadedUpdateIfAllowed(activity, completedId);
    }

    public static void resumePendingInstall(Activity activity) {
        SharedPreferences preferences = activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long pendingId = preferences.getLong(PENDING_DOWNLOAD_ID, -1L);
        if (pendingId == -1L) return;

        DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(pendingId))) {
            if (cursor == null || !cursor.moveToFirst()) {
                clearPendingDownload(preferences);
                return;
            }
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                openDownloadedUpdateIfAllowed(activity, pendingId);
            } else if (status == DownloadManager.STATUS_FAILED) {
                clearPendingDownload(preferences);
            }
        }
    }

    private static void showUpdateDialog(Activity activity, String currentVersion, String latestVersion, String downloadUrl) {
        new AlertDialog.Builder(activity)
            .setTitle("CathoScroll update available")
            .setMessage("Version " + latestVersion + " is available. You are currently using version " + currentVersion + ".")
            .setPositiveButton("Download update", (dialog, which) -> downloadUpdate(activity, latestVersion, downloadUrl))
            .setNegativeButton("Later", null)
            .setCancelable(true)
            .show();
    }

    private static void downloadUpdate(Activity activity, String version, String downloadUrl) {
        try {
            DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            String fileName = "CathoScroll-" + version + ".apk";
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(downloadUrl))
                .setTitle("CathoScroll " + version)
                .setDescription("Downloading the latest CathoScroll update")
                .setMimeType(APK_MIME_TYPE)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)
                .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, fileName);

            long downloadId = manager.enqueue(request);
            activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().putLong(PENDING_DOWNLOAD_ID, downloadId).apply();
            Toast.makeText(activity, "CathoScroll update downloading. Android will notify you when it is ready.", Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            android.util.Log.e("CathoScrollUpdates", "Unable to start the Android update download.", error);
            Toast.makeText(activity, "Unable to download the CathoScroll update.", Toast.LENGTH_LONG).show();
        }
    }

    private static void openDownloadedUpdateIfAllowed(Activity activity, long downloadId) {
        if (activity.isFinishing() || activity.isDestroyed()) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.getPackageManager().canRequestPackageInstalls()) {
            new AlertDialog.Builder(activity)
                .setTitle("Allow CathoScroll updates")
                .setMessage("To install this update, allow CathoScroll to install apps from this source. Android will ask you to confirm the installation.")
                .setPositiveButton("Open settings", (dialog, which) -> {
                    Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + activity.getPackageName()));
                    activity.startActivity(settingsIntent);
                })
                .setNegativeButton("Later", null)
                .show();
            return;
        }

        DownloadManager manager = (DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
        Uri apkUri = manager.getUriForDownloadedFile(downloadId);
        if (apkUri == null) {
            Toast.makeText(activity, "The downloaded CathoScroll APK is unavailable.", Toast.LENGTH_LONG).show();
            return;
        }

        try {
            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, APK_MIME_TYPE);
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(installIntent);
            activity.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit().remove(PENDING_DOWNLOAD_ID).apply();
        } catch (Exception error) {
            android.util.Log.e("CathoScrollUpdates", "Unable to open the Android package installer.", error);
            Toast.makeText(activity, "Android could not open the CathoScroll installer.", Toast.LENGTH_LONG).show();
        }
    }

    private static boolean isStableVersion(String version) {
        return version != null && version.matches("\\d+\\.\\d+\\.\\d+");
    }

    private static boolean isNewerVersion(String latest, String current) {
        String[] latestParts = latest.split("\\.");
        String[] currentParts = current.split("\\.");
        for (int index = 0; index < 3; index++) {
            int latestPart = Integer.parseInt(latestParts[index]);
            int currentPart = Integer.parseInt(currentParts[index]);
            if (latestPart > currentPart) return true;
            if (latestPart < currentPart) return false;
        }
        return false;
    }

    private static void clearPendingDownload(SharedPreferences preferences) {
        preferences.edit().remove(PENDING_DOWNLOAD_ID).apply();
    }

    private static void showToast(Activity activity, String message) {
        activity.runOnUiThread(() -> Toast.makeText(activity, message, Toast.LENGTH_LONG).show());
    }
}
