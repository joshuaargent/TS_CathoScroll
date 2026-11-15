package com.joshuaargent.cathoscroll;

import java.io.File;
import java.io.IOException;

final class LegacyActivityCleanup {
    interface DatabaseDeleter {
        boolean deleteDatabase() throws IOException;
    }

    static void remove(File database, DatabaseDeleter deleter) throws IOException {
        // Android's database deletion handles SQLite's normal sidecars. The
        // explicit checks below make retries safe if termination interrupts it.
        deleter.deleteDatabase();

        for (String suffix : new String[] { "-wal", "-shm", "-journal" }) {
            File sidecar = new File(database.getAbsolutePath() + suffix);
            if (sidecar.exists() && !sidecar.delete()) {
                throw new IOException("Unable to remove the migrated plaintext activity sidecar: " + sidecar.getName());
            }
        }

        if (database.exists() && !database.delete()) {
            throw new IOException("Unable to remove the migrated plaintext activity database.");
        }
    }

    private LegacyActivityCleanup() {}
}
