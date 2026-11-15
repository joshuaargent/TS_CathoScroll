package com.joshuaargent.cathoscroll;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class CatalogueInstallerTest {
    @Rule
    public TemporaryFolder folder = new TemporaryFolder();

    @Test
    public void interruptedCopyDoesNotPublishAndCanBeRetried() throws Exception {
        File directory = folder.newFolder();
        File destination = new File(directory, "catalogueSQLite.db");
        File activity = new File(directory, "activitySQLite.db");
        Files.write(activity.toPath(), new byte[] { 9 });
        byte[] catalogue = new byte[] { 1, 2, 3 };

        assertThrows(IOException.class, () -> CatalogueInstaller.install(
            destination,
            () -> new InputStream() {
                private boolean read;

                @Override
                public int read() throws IOException {
                    if (read) throw new IOException("Interrupted copy");
                    read = true;
                    return 1;
                }
            },
            file -> {},
            (temporary, target) -> Files.move(temporary.toPath(), target.toPath())
        ));
        assertFalse(destination.exists());
        assertArrayEquals(new byte[] { 9 }, Files.readAllBytes(activity.toPath()));
        assertEquals(1, directory.list().length);

        CatalogueInstaller.install(
            destination,
            () -> new ByteArrayInputStream(catalogue),
            file -> assertArrayEquals(catalogue, Files.readAllBytes(file.toPath())),
            (temporary, target) -> Files.move(temporary.toPath(), target.toPath())
        );
        assertArrayEquals(catalogue, Files.readAllBytes(destination.toPath()));
        assertArrayEquals(new byte[] { 9 }, Files.readAllBytes(activity.toPath()));
        assertEquals(2, directory.list().length);
    }

    @Test
    public void validationFailureDoesNotPublishOrOverwriteExistingDatabases() throws Exception {
        File directory = folder.newFolder();
        File destination = new File(directory, "catalogueSQLite.db");
        assertThrows(IOException.class, () -> CatalogueInstaller.install(
            destination,
            () -> new ByteArrayInputStream(new byte[] { 1 }),
            file -> { throw new IOException("Invalid catalogue"); },
            (temporary, target) -> Files.move(temporary.toPath(), target.toPath())
        ));
        assertFalse(destination.exists());
        assertEquals(0, directory.list().length);

        Files.write(destination.toPath(), new byte[] { 7 });
        CatalogueInstaller.install(
            destination,
            () -> { throw new IOException("Existing catalogue must not be replaced"); },
            file -> {},
            (temporary, target) -> Files.move(temporary.toPath(), target.toPath())
        );
        assertArrayEquals(new byte[] { 7 }, Files.readAllBytes(destination.toPath()));
    }

    @Test
    public void interruptedPlaintextActivityCleanupCanBeRetriedSafely() throws Exception {
        File directory = folder.newFolder();
        File database = new File(directory, "activitySQLite.db");
        File wal = new File(database.getAbsolutePath() + "-wal");
        File shm = new File(database.getAbsolutePath() + "-shm");
        File journal = new File(database.getAbsolutePath() + "-journal");
        Files.write(database.toPath(), new byte[] { 1, 2, 3 });
        Files.write(wal.toPath(), new byte[] { 4 });
        Files.write(shm.toPath(), new byte[] { 5 });
        Files.write(journal.toPath(), new byte[] { 6 });

        assertThrows(IOException.class, () -> LegacyActivityCleanup.remove(database, () -> {
            Files.deleteIfExists(database.toPath());
            throw new IOException("Simulated process interruption during cleanup");
        }));
        assertFalse(database.exists());
        assertTrue(wal.exists());
        assertTrue(shm.exists());
        assertTrue(journal.exists());

        // The next startup retries cleanup after the verified encrypted migration.
        LegacyActivityCleanup.remove(database, () -> false);
        assertFalse(database.exists());
        assertFalse(wal.exists());
        assertFalse(shm.exists());
        assertFalse(journal.exists());

        // Cleanup remains safe if startup repeats it again.
        LegacyActivityCleanup.remove(database, () -> false);
    }

    @Test
    public void failedPlaintextCleanupDoesNotSilentlyDiscardRemainingFiles() throws Exception {
        File directory = folder.newFolder();
        File database = new File(directory, "activitySQLite.db");
        assertTrue(database.mkdir());
        File contents = new File(database, "keep.txt");
        Files.write(contents.toPath(), new byte[] { 9 });

        assertThrows(IOException.class, () ->
            LegacyActivityCleanup.remove(database, () -> false)
        );
        assertTrue(contents.exists());
        assertTrue(database.exists());
    }
}
