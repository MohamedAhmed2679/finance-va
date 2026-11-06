package com.financeva.app.autotrack;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONObject;

import java.security.MessageDigest;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Receives NEW text messages (RECEIVE_SMS). Only messages from bank / wallet senders the user's
 * Zaylo knows are kept (encrypted) for processing; everything else is ignored on the spot and never
 * stored. Does nothing unless AutoTrack is turned on and not paused.
 */
public class SmsReceiver extends BroadcastReceiver {
    static final String CHANNEL = "zaylo_autotrack";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        android.content.SharedPreferences p = SecureQueue.prefs(ctx);
        if (!p.getBoolean("enabled", false) || p.getBoolean("paused", false)) return;

        SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
        if (parts == null || parts.length == 0) return;
        // a long SMS arrives in parts: join them per sender
        Map<String, StringBuilder> bodies = new LinkedHashMap<>();
        long ts = System.currentTimeMillis();
        for (SmsMessage m : parts) {
            if (m == null) continue;
            String from = m.getDisplayOriginatingAddress();
            if (from == null || !SecureQueue.isFinancialSender(ctx, from)) continue;
            StringBuilder b = bodies.get(from);
            if (b == null) { b = new StringBuilder(); bodies.put(from, b); }
            b.append(m.getDisplayMessageBody());
            ts = m.getTimestampMillis() > 0 ? m.getTimestampMillis() : ts;
        }
        if (bodies.isEmpty()) return;

        int kept = 0;
        for (Map.Entry<String, StringBuilder> e : bodies.entrySet()) {
            try {
                JSONObject o = new JSONObject();
                o.put("id", sha256(e.getKey() + "|" + ts + "|" + e.getValue()));
                o.put("sender", e.getKey());
                o.put("body", e.getValue().toString());
                o.put("receivedAtMs", ts);
                SecureQueue.add(ctx, o);
                kept++;
            } catch (Exception ignored) { }
        }
        if (kept == 0) return;
        p.edit().putLong("lastReceivedAt", System.currentTimeMillis()).apply();

        if (ZayloSmsPlugin.instance != null) ZayloSmsPlugin.instance.onNewMessages();   // app is open: process now
        else notifyWaiting(ctx);                                                           // otherwise: a private reminder
    }

    /** "A bank alert is ready to review" — never the amount, merchant or sender. */
    private static void notifyWaiting(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, "AutoTrack", NotificationManager.IMPORTANCE_LOW));
            }
            Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (open == null) return;
            open.setData(android.net.Uri.parse("com.financeva.app://autotrack"));
            PendingIntent pi = PendingIntent.getActivity(ctx, 4711, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder n = new NotificationCompat.Builder(ctx, CHANNEL)
                    .setSmallIcon(ctx.getApplicationInfo().icon)
                    .setContentTitle("Zaylo AutoTrack")
                    .setContentText("A new bank or wallet alert is ready. Open Zaylo to add it.")
                    .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            NotificationManagerCompat.from(ctx).notify(4711, n.build());
        } catch (SecurityException ignored) { /* notifications not allowed: the alert still waits in Zaylo */ }
    }

    static String sha256(String s) throws Exception {
        byte[] h = MessageDigest.getInstance("SHA-256").digest(s.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (byte b : h) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
