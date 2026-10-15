package com.bobc.crm;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/** Serves only the packaged CRM; HTTPS here is an origin, not a network server. */
final class LocalAssetClient extends WebViewClient {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String START_URL = ORIGIN + "/index.html";
    private final AssetManager assets;
    private final MainActivity activity;

    LocalAssetClient(AssetManager assets, MainActivity activity) {
        this.assets = assets;
        this.activity = activity;
    }

    static boolean isLocalOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme())
            && "appassets.androidplatform.net".equals(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443)
            && uri.getUserInfo() == null;
    }

    static boolean isMainDocument(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        return isLocalOrigin(uri)
            && ("/".equals(uri.getPath()) || "/index.html".equals(uri.getPath()));
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (isMainDocument(request.getUrl().toString())) return false;
        if (request.isForMainFrame()) activity.openExternalLink(request.getUrl());
        return true;
    }

    @Override
    public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
        activity.setTrustedPage(isMainDocument(url));
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        if (!isLocalOrigin(uri) || !"GET".equals(request.getMethod())) {
            return error(403, "Forbidden");
        }
        String path = uri.getPath();
        if ("/".equals(path)) path = "/index.html";
        // getPath decodes percent escapes; reject traversal and double encoding.
        if (path == null || !path.matches("/[A-Za-z0-9_./-]+")) {
            return error(403, "Forbidden");
        }
        for (String component : path.split("/", -1)) {
            if (".".equals(component) || "..".equals(component)) {
                return error(403, "Forbidden");
            }
        }
        String mime = mimeForAllowedPath(path);
        if (mime == null) return error(403, "Forbidden");
        try {
            InputStream stream = assets.open("crm" + path, AssetManager.ACCESS_STREAMING);
            Map<String, String> headers = new HashMap<>();
            headers.put("Cache-Control", "no-store");
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; "
                + "style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
                + "connect-src 'self'; object-src 'none'; frame-src 'none'; "
                + "base-uri 'self'; form-action 'self'");
            return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream);
        } catch (IOException missing) {
            return error(404, "Not Found");
        }
    }

    private static String mimeForAllowedPath(String path) {
        if ("/index.html".equals(path)) return "text/html";
        if (path.startsWith("/css/") && path.endsWith(".css")) return "text/css";
        if (path.startsWith("/data/") && path.endsWith(".json")) return "application/json";
        if (path.startsWith("/js/") && path.endsWith(".js")) return "text/javascript";
        return null;
    }

    private static WebResourceResponse error(int code, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", code, reason,
            java.util.Collections.singletonMap("Cache-Control", "no-store"),
            new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }
}
