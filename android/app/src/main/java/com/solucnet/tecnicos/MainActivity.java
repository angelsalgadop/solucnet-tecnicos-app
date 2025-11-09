package com.solucnet.tecnicos;

import android.os.Bundle;
import android.widget.Toast;
import android.view.WindowManager;
import android.os.Build;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private long backPressedTime = 0;
    private static final int BACK_PRESS_INTERVAL = 2000; // 2 segundos

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Configurar la ventana para respetar los insets del sistema (status bar, navigation bar)
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Hacer que la status bar sea transparente pero con contenido oscuro
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            getWindow().setStatusBarColor(android.graphics.Color.TRANSPARENT);

            // Configurar el color de los iconos de la status bar
            WindowInsetsControllerCompat windowInsetsController =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            if (windowInsetsController != null) {
                // true = iconos oscuros (para fondo claro), false = iconos claros (para fondo oscuro)
                windowInsetsController.setAppearanceLightStatusBars(true);
            }
        }

        // Habilitar debugging de WebView para inspeccionar desde Chrome
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.KITKAT) {
            android.webkit.WebView.setWebContentsDebuggingEnabled(true);
        }

        // CRÍTICO: Configurar WebView para persistir localStorage
        // Sin esto, localStorage se borra al cerrar la app
        if (getBridge() != null && getBridge().getWebView() != null) {
            android.webkit.WebSettings webSettings = getBridge().getWebView().getSettings();
            webSettings.setDomStorageEnabled(true);
            webSettings.setDatabaseEnabled(true);

            // Configurar directorio de datos persistente
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.KITKAT) {
                String databasePath = getApplicationContext().getDir("database", MODE_PRIVATE).getPath();
                webSettings.setDatabasePath(databasePath);
            }
        }
    }


    @Override
    public void onStart() {
        super.onStart();

        // Aplicar WebViewClient personalizado que acepta certificados SSL
        getBridge().getWebView().setWebViewClient(new SSLWebViewClient(getBridge()));
    }

    @Override
    public void onBackPressed() {
        // Si están en la página principal (login o visitas), manejar doble presión
        if (shouldShowExitDialog()) {
            long currentTime = System.currentTimeMillis();

            if (currentTime - backPressedTime < BACK_PRESS_INTERVAL) {
                // Segunda presión dentro del intervalo - mostrar diálogo
                showExitDialog();
            } else {
                // Primera presión - mostrar toast
                backPressedTime = currentTime;
                Toast.makeText(this, "Presiona atrás nuevamente para salir", Toast.LENGTH_SHORT).show();
            }
        } else {
            // En otras páginas, comportamiento normal
            super.onBackPressed();
        }
    }

    private boolean shouldShowExitDialog() {
        // Verificar si estamos en una página principal
        String url = getBridge().getWebView().getUrl();
        return url != null && (
            url.contains("login_tecnicos.html") ||
            url.contains("tecnicos_visitas.html") ||
            url.endsWith("/")
        );
    }

    private void showExitDialog() {
        new AlertDialog.Builder(this)
            .setTitle("Salir de la aplicación")
            .setMessage("¿Deseas cerrar SolucNet Técnicos?")
            .setPositiveButton("Salir", (dialog, which) -> {
                finishAffinity(); // Cierra completamente la app
            })
            .setNegativeButton("Cancelar", (dialog, which) -> {
                dialog.dismiss();
                backPressedTime = 0; // Reset del contador
            })
            .setCancelable(true)
            .show();
    }
}
