package com.joshuaargent.cathoscroll;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteException;
import android.system.ErrnoException;
import android.system.Os;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;

@CapacitorPlugin(name = "CathoCatalogueAsset")
public class CatalogueAssetPlugin extends Plugin {
    @PluginMethod
    public void prepare(PluginCall call) {
        File destination = getContext().getDatabasePath("catalogueSQLite.db");
        try {
            CatalogueInstaller.install(
                destination,
                () -> getContext().getAssets().open("public/assets/databases/catalogue.db"),
                CatalogueAssetPlugin::validate,
                CatalogueAssetPlugin::publish
            );
            call.resolve();
        } catch (IOException error) {
            call.reject("Unable to prepare the offline catalogue.", error);
        }
    }

    private static void validate(File file) throws IOException {
        try (SQLiteDatabase database = SQLiteDatabase.openDatabase(
            file.getAbsolutePath(),
            null,
            SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS
        ); Cursor integrity = database.rawQuery("PRAGMA quick_check(1)", null)) {
            if (!integrity.moveToFirst() || !"ok".equals(integrity.getString(0)) || integrity.moveToNext()) {
                throw new IOException("The bundled catalogue failed its integrity check.");
            }
            try (Cursor metadata = database.rawQuery(
                "SELECT format, category_count, topic_count FROM catalogue_metadata WHERE singleton = 1",
                null
            )) {
                if (
                    !metadata.moveToFirst() ||
                    metadata.getInt(0) != 1 ||
                    metadata.getLong(1) < 0 ||
                    metadata.getLong(2) < 0 ||
                    metadata.moveToNext()
                ) {
                    throw new IOException("The bundled catalogue metadata is invalid.");
                }
            }
        } catch (SQLiteException error) {
            throw new IOException("Unable to validate the bundled catalogue.", error);
        }
    }

    private static void publish(File temporary, File destination) throws IOException {
        if (destination.exists()) return;
        try {
            Os.rename(temporary.getAbsolutePath(), destination.getAbsolutePath());
        } catch (ErrnoException error) {
            throw new IOException("Unable to publish the offline catalogue.", error);
        }
    }
}
