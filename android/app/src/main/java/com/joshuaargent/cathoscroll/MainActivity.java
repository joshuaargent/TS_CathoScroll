package com.joshuaargent.cathoscroll;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(CatalogueAssetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
