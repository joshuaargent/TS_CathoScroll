package com.joshuaargent.cathoscroll;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;

final class CatalogueInstaller {
    interface Source {
        InputStream open() throws IOException;
    }

    interface Validator {
        void validate(File file) throws IOException;
    }

    interface Publisher {
        void publish(File temporary, File destination) throws IOException;
    }

    static synchronized void install(File destination, Source source, Validator validator, Publisher publisher)
        throws IOException {
        File directory = destination.getParentFile();
        if (directory == null || (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory())) {
            throw new IOException("Unable to create the catalogue database directory.");
        }

        if (destination.exists()) {
            try {
                validator.validate(destination);
                return;
            } catch (IOException invalidCatalogue) {
                // The catalogue contains public content only. Keep a recoverable
                // copy until a validated replacement has been published.
                File backup = new File(directory, destination.getName() + ".corrupt-" + System.nanoTime());
                if (!destination.renameTo(backup)) {
                    throw new IOException("Unable to preserve the damaged offline catalogue.", invalidCatalogue);
                }
                try {
                    removeSidecars(destination);
                    installReplacement(destination, backup, source, validator, publisher, directory);
                } catch (IOException repairError) {
                    if (!destination.exists() && backup.exists() && !backup.renameTo(destination)) {
                        repairError.addSuppressed(new IOException(
                            "Unable to restore the previous catalogue after a failed repair."
                        ));
                    }
                    throw repairError;
                }
                return;
            }
        }

        installReplacement(destination, null, source, validator, publisher, directory);
    }

    private static void installReplacement(
        File destination,
        File backup,
        Source source,
        Validator validator,
        Publisher publisher,
        File directory
    ) throws IOException {
        File temporary = File.createTempFile("catalogue-copy-", ".tmp", directory);
        Throwable failure = null;
        boolean published = false;
        try {
            try (InputStream input = source.open(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[16384];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                }
                output.flush();
                output.getFD().sync();
            }
            validator.validate(temporary);
            publisher.publish(temporary, destination);
            published = true;
        } catch (IOException | RuntimeException | Error error) {
            failure = error;
            throw error;
        } finally {
            if (temporary.exists() && !temporary.delete()) {
                IOException cleanupError = new IOException("Unable to remove the temporary catalogue copy.");
                if (failure != null) failure.addSuppressed(cleanupError);
                else throw cleanupError;
            }
            if (backup != null) {
                if (published) {
                    if (backup.exists() && !backup.delete()) {
                        // A stale corrupt backup is harmless and must not invalidate
                        // the successfully published catalogue.
                    }
                } else if (!destination.exists() && backup.exists() && !backup.renameTo(destination)) {
                    IOException restoreError = new IOException("Unable to restore the previous catalogue after a failed repair.");
                    if (failure != null) failure.addSuppressed(restoreError);
                    else throw restoreError;
                }
            }
        }
    }

    private static void removeSidecars(File database) throws IOException {
        for (String suffix : new String[] {"-wal", "-shm", "-journal"}) {
            File sidecar = new File(database.getAbsolutePath() + suffix);
            if (sidecar.exists() && !sidecar.delete()) {
                throw new IOException("Unable to remove a damaged catalogue sidecar.");
            }
        }
    }

    private CatalogueInstaller() {}
}
