package com.joshuaargent.cathoscroll;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.CapConfig;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginLoadException;
import com.getcapacitor.PluginManager;
import java.util.List;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CatalogueAssetPlugin.class);
        registerPlugin(SecureAuthGuardPlugin.class);
        super.onCreate(savedInstanceState);
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
