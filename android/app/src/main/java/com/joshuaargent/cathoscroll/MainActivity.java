package com.joshuaargent.cathoscroll;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Bundle;

import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginLoadException;
import com.getcapacitor.PluginManager;

import java.util.List;

public class MainActivity extends BridgeActivity {
    private boolean updateCheckStarted;
    private boolean updateReceiverRegistered;

    private final BroadcastReceiver updateDownloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            AndroidUpdateChecker.handleDownloadCompleted(MainActivity.this, intent);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CatalogueAssetPlugin.class);
        registerPlugin(SecureAuthGuardPlugin.class);
        super.onCreate(savedInstanceState);

        IntentFilter filter = new IntentFilter(android.app.DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        ContextCompat.registerReceiver(this, updateDownloadReceiver, filter, ContextCompat.RECEIVER_EXPORTED);
        updateReceiverRegistered = true;
    }

    @Override
    protected void onStart() {
        super.onStart();
        if (!updateCheckStarted) {
            updateCheckStarted = true;
            AndroidUpdateChecker.checkForUpdates(this);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        AndroidUpdateChecker.resumePendingInstall(this);
    }

    @Override
    protected void onDestroy() {
        if (updateReceiverRegistered) {
            unregisterReceiver(updateDownloadReceiver);
            updateReceiverRegistered = false;
        }
        super.onDestroy();
    }

    @Override
    protected void load() {
        if (config == null) config = CapConfig.loadDefault(this);
        if (config.getServerUrl() != null) {
            try {
                List<Class<? extends Plugin>> plugins = new PluginManager(getAssets()).loadPluginClasses();
                plugins.removeIf(plugin ->
                    plugin.getName().equals("com.aparajita.capacitor.securestorage.SecureStorage") ||
                    plugin.getName().equals("com.getcapacitor.community.database.sqlite.CapacitorSQLitePlugin")
                );
                plugins.add(CatalogueAssetPlugin.class);
                bridgeBuilder.setPlugins(plugins);
            } catch (PluginLoadException error) {
                throw new IllegalStateException("Unable to safely configure native plugins.", error);
            }
        }
        super.load();
    }
}
