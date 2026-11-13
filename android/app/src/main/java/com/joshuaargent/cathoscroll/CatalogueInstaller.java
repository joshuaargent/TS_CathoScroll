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
        if (destination.exists()) return;

        File directory = destination.getParentFile();
        if (directory == null || (!directory.isDirectory() && !directory.mkdirs() && !directory.isDirectory())) {
            throw new IOException("Unable to create the catalogue database directory.");
        }

        File temporary = File.createTempFile("catalogue-copy-", ".tmp", directory);
        Throwable failure = null;
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
        } catch (IOException | RuntimeException | Error error) {
            failure = error;
            throw error;
        } finally {
            if (temporary.exists() && !temporary.delete()) {
                IOException cleanupError = new IOException("Unable to remove the temporary catalogue copy.");
                if (failure != null) failure.addSuppressed(cleanupError);
                else throw cleanupError;
            }
        }
    }

    private CatalogueInstaller() {}
}
