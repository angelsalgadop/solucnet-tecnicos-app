package com.solucnet.tecnicos;

import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebResourceError;
import android.util.Log;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

public class SSLWebViewClient extends BridgeWebViewClient {

    private static final String TAG = "SSLWebViewClient";

    public SSLWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        // Aceptar TODOS los certificados SSL (desarrollo/staging)
        // ADVERTENCIA: En producción, validar correctamente los certificados
        String url = error.getUrl();
        Log.d(TAG, "SSL Error para URL: " + url);
        Log.d(TAG, "Error type: " + error.getPrimaryError());

        if (url != null && (url.contains("cliente.solucnet.com") || url.contains("solucnet.com"))) {
            Log.d(TAG, "Aceptando certificado para: " + url);
            handler.proceed(); // Continuar a pesar del error SSL
        } else {
            Log.d(TAG, "Rechazando certificado para: " + url);
            super.onReceivedSslError(view, handler, error);
        }
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        Log.e(TAG, "Error de recurso: " + error.getDescription());
        Log.e(TAG, "URL: " + request.getUrl());
        Log.e(TAG, "Error code: " + error.getErrorCode());
        super.onReceivedError(view, request, error);
    }

    @Override
    public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
        Log.e(TAG, "HTTP Error: " + errorResponse.getStatusCode());
        Log.e(TAG, "URL: " + request.getUrl());
        super.onReceivedHttpError(view, request, errorResponse);
    }
}
