package com.solucnet.tecnicos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Cargar directamente login_tecnicos.html en lugar de index.html
        load("login_tecnicos.html");
    }
}
