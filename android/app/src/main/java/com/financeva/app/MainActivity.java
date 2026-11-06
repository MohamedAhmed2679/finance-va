package com.financeva.app;

import android.content.Intent;
import android.os.Bundle;

import com.financeva.app.autotrack.ZayloSmsPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ZayloSmsPlugin.class);
        super.onCreate(savedInstanceState);
        takeShared(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        takeShared(intent);
    }

    /** "Share → Zaylo" from a messaging app: hand the text to AutoTrack's Paste screen. */
    private void takeShared(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction()) || !"text/plain".equals(intent.getType())) return;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text != null && text.length() > 0) ZayloSmsPlugin.receiveShared(text.toString());
    }
}
