package com.joshuaargent.cathoscroll;

import android.content.Context;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.security.GeneralSecurityException;
import java.security.KeyStore;

@CapacitorPlugin(name = "CathoSecureAuthGuard")
public class SecureAuthGuardPlugin extends Plugin {
    @PluginMethod
    public void verify(PluginCall call) {
        if (getBridge().getServerUrl() != null) {
            call.reject("Secure storage is unavailable in the hosted wrapper.");
            return;
        }
        String key = call.getString("key");
        if (
            key == null ||
            key.length() > 256 ||
            !(key.equals("cathoscroll.auth.v1") || key.startsWith("cathoscroll.auth.v1-")) ||
            !key.matches("[a-zA-Z0-9._-]+")
        ) {
            call.reject("Invalid secure storage key.");
            return;
        }
        try {
            boolean hasData = getContext()
                .getSharedPreferences("WSSecureStorageSharedPreferences", Context.MODE_PRIVATE)
                .contains(key);
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (hasData && !store.containsAlias(key)) {
                call.reject("The secure storage key is unavailable. Sign-in recovery is required.");
                return;
            }
            call.resolve();
        } catch (GeneralSecurityException | IOException error) {
            call.reject("Unable to verify secure storage.", error);
        }
    }
}
