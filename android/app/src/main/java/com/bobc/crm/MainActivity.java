package com.bobc.crm;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;
import android.widget.Toast;

/** Independent, offline BOBC CRM application. No Artesanía activity or storage. */
public final class MainActivity extends Activity {
    private static final int REQUEST_OPEN = 2102;
    private WebView webView;
    private DocumentBridge documents;
    private ValueCallback<Uri[]> fileSelection;
    private volatile boolean trustedPage;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(23, 59, 97));
        setContentView(root);
        applySystemInsets(root);
        try {
            webView = new WebView(this);
        } catch (RuntimeException missingWebView) {
            new AlertDialog.Builder(this).setTitle("BOBC CRM")
                .setMessage("Activa o actualiza Android System WebView para abrir el CRM.")
                .setPositiveButton("Cerrar", (dialog, which) -> finish())
                .setCancelable(false).show();
            return;
        }
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        webView.setBackgroundColor(Color.rgb(252, 236, 212));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // Only document-picker URIs for JSON import.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        WebView.setWebContentsDebuggingEnabled(
            (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        documents = new DocumentBridge(this, webView, () -> trustedPage);
        webView.addJavascriptInterface(documents, "BobcAndroid");
        webView.setWebViewClient(new LocalAssetClient(getAssets(), this));
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams parameters) {
                if (!trustedPage) return false;
                if (fileSelection != null) fileSelection.onReceiveValue(null);
                fileSelection = callback;
                Intent open = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*")
                    .putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                        "application/json", "text/plain", "application/octet-stream"
                    });
                try {
                    startActivityForResult(open, REQUEST_OPEN);
                } catch (android.content.ActivityNotFoundException | SecurityException unavailable) {
                    fileSelection.onReceiveValue(null);
                    fileSelection = null;
                    Toast.makeText(MainActivity.this,
                        "El selector de documentos no está disponible.", Toast.LENGTH_LONG).show();
                }
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                if (!LocalAssetClient.isMainDocument(url)) {
                    result.cancel();
                    return true;
                }
                new AlertDialog.Builder(MainActivity.this).setTitle("BOBC CRM")
                    .setMessage(message)
                    .setPositiveButton("Aceptar", (dialog, which) -> result.confirm())
                    .setNegativeButton("Cancelar", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
                return true;
            }
        });
        if (state == null || webView.restoreState(state) == null) {
            webView.loadUrl(LocalAssetClient.START_URL);
        }
        if (state != null && state.getBoolean("bobc_export_interrupted")) {
            Toast.makeText(this, "La exportación se interrumpió. Vuelve a exportar.",
                Toast.LENGTH_LONG).show();
        }
    }

    private void applySystemInsets(FrameLayout root) {
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right,
                    Math.max(bars.bottom, keyboard.bottom));
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        root.requestApplyInsets();
    }

    void setTrustedPage(boolean trusted) {
        trustedPage = trusted;
    }

    void openExternalLink(Uri uri) {
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (android.content.ActivityNotFoundException | SecurityException unavailable) {
            Toast.makeText(this, "No hay un navegador disponible.", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (documents != null && documents.onActivityResult(requestCode, resultCode, data)) return;
        if (requestCode == REQUEST_OPEN && fileSelection != null) {
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            fileSelection.onReceiveValue(uri != null && "content".equals(uri.getScheme())
                ? new Uri[] {uri} : null);
            fileSelection = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (webView != null) webView.saveState(state);
        if (documents != null) documents.saveInstanceState(state);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        trustedPage = false;
        if (fileSelection != null) fileSelection.onReceiveValue(null);
        fileSelection = null;
        if (documents != null) documents.close();
        if (webView != null) {
            webView.removeJavascriptInterface("BobcAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }
}
