package com.bobc.crm;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

/** Minimal bridge: app-origin JSON/CSV exports go through Android's document picker. */
final class DocumentBridge {
    private static final int REQUEST_SAVE = 2101;
    static final int MAX_BYTES = 32 * 1024 * 1024;
    private static final int MAX_BASE64_CHARS = 4 * ((MAX_BYTES + 2) / 3);
    private final Activity activity;
    private final WebView webView;
    private final BooleanSupplier trustedPage;
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean closed;
    private volatile Export pending;

    DocumentBridge(Activity activity, WebView webView, BooleanSupplier trustedPage) {
        this.activity = activity;
        this.webView = webView;
        this.trustedPage = trustedPage;
    }

    @JavascriptInterface
    public void saveFile(String base64, String filename, String mime, String requestId) {
        if (closed || !trustedPage.getAsBoolean()) return;
        if (requestId == null || !requestId.matches("[A-Za-z0-9_.:-]{1,128}")) return;
        String name = safeFilename(filename, mime);
        if (name == null || base64 == null || base64.length() > MAX_BASE64_CHARS) {
            emit(requestId, name, false, "Archivo inválido o mayor de 32 MiB.", false);
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            emit(requestId, name, false, "Ya hay una exportación en curso.", false);
            return;
        }
        // Decoding and writing stay off the UI thread; the bridge never writes a path.
        try {
            worker.execute(() -> {
                try {
                    if (!base64.matches("[A-Za-z0-9+/]*={0,2}") || base64.length() % 4 != 0) {
                        throw new IllegalArgumentException("Invalid base64");
                    }
                    byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
                    if (bytes.length > MAX_BYTES) throw new IllegalArgumentException("Too large");
                    Export export = new Export(requestId, name, mime, bytes);
                    activity.runOnUiThread(() -> chooseDestination(export));
                } catch (IllegalArgumentException | OutOfMemoryError invalid) {
                    busy.set(false);
                    emit(requestId, name, false, "No se pudo preparar la exportación.", false);
                }
            });
        } catch (RejectedExecutionException interrupted) {
            // Activity destruction can race with a call from the bridge thread.
            busy.set(false);
            emit(requestId, name, false, "La exportación se interrumpió. Vuelve a exportar.", false);
        }
    }

    private void chooseDestination(Export export) {
        if (closed || !trustedPage.getAsBoolean()) {
            busy.set(false);
            return;
        }
        pending = export;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(export.mime)
            .putExtra(Intent.EXTRA_TITLE, export.name);
        try {
            activity.startActivityForResult(intent, REQUEST_SAVE);
        } catch (android.content.ActivityNotFoundException | SecurityException unavailable) {
            complete(export, false, "El selector de documentos no está disponible.", false);
        }
    }

    boolean onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_SAVE) return false;
        Export export = pending;
        if (export == null) return true;
        if (resultCode != Activity.RESULT_OK || data == null || data.getData() == null) {
            complete(export, false, null, true);
            return true;
        }
        Uri destination = data.getData();
        if (!"content".equals(destination.getScheme())) {
            complete(export, false, "Destino de documento inválido.", false);
            return true;
        }
        worker.execute(() -> {
            try (OutputStream output = activity.getContentResolver().openOutputStream(destination, "wt")) {
                if (output == null) throw new IOException("No output stream");
                output.write(export.bytes);
                output.flush();
                // Complete only after close also succeeds.
            } catch (IOException | RuntimeException failure) {
                // A document provider can reject an otherwise valid content URI/mode.
                complete(export, false, "No se pudo guardar el archivo. Vuelve a exportar.", false);
                return;
            }
            complete(export, true, null, false);
        });
        return true;
    }

    void saveInstanceState(Bundle state) {
        if (busy.get()) state.putBoolean("bobc_export_interrupted", true);
    }

    void close() {
        closed = true;
        pending = null;
        busy.set(false);
        worker.shutdownNow();
    }

    private void complete(Export export, boolean success, String error, boolean cancelled) {
        pending = null;
        busy.set(false);
        emit(export.requestId, export.name, success, error, cancelled);
    }

    private void emit(String requestId, String name, boolean success, String error, boolean cancelled) {
        if (closed) return;
        JSONObject detail = new JSONObject();
        try {
            detail.put("requestId", requestId);
            detail.put("name", name == null ? "" : name);
            detail.put("success", success);
            if (error != null) detail.put("error", error);
            if (cancelled) detail.put("cancelled", true);
        } catch (JSONException impossible) {
            return;
        }
        String script = "window.dispatchEvent(new CustomEvent('bobc-file-result',{detail:"
            + detail + "}));";
        activity.runOnUiThread(() -> {
            if (!closed && trustedPage.getAsBoolean()
                && LocalAssetClient.isMainDocument(webView.getUrl())) {
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private static String safeFilename(String filename, String mime) {
        String extension;
        if ("application/json".equals(mime)) extension = ".json";
        else if ("text/csv".equals(mime)) extension = ".csv";
        else return null;
        if (filename == null || !filename.toLowerCase(java.util.Locale.ROOT).endsWith(extension)) {
            return null;
        }
        String name = filename.replaceAll("[^A-Za-z0-9._-]", "_");
        if (name.length() > 160 || name.startsWith(".") || name.contains("..")) return null;
        return name;
    }

    private static final class Export {
        final String requestId;
        final String name;
        final String mime;
        final byte[] bytes;

        Export(String requestId, String name, String mime, byte[] bytes) {
            this.requestId = requestId;
            this.name = name;
            this.mime = mime;
            this.bytes = bytes;
        }
    }
}
