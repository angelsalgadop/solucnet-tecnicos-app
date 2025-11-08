package com.solucnet.tecnicos;

import android.net.http.SslError;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import android.webkit.WebResourceRequest;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

public class SSLWebViewClient extends BridgeWebViewClient {

    public SSLWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        // Solo aceptar certificados autofirmados para cliente.solucnet.com
        String url = error.getUrl();
        if (url != null && url.contains("cliente.solucnet.com")) {
            handler.proceed();
        } else {
            super.onReceivedSslError(view, handler, error);
        }
    }
}
