package com.financeva.app.autotrack;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.Settings;
import android.provider.Telephony;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

/**
 * Zaylo AutoTrack bridge (window.Capacitor.Plugins.ZayloSms).
 *  - "sms":     RECEIVE_SMS, asked only after the user agrees in Zaylo's own explanation
 *  - "history": READ_SMS, asked only for a one-off import of a date range the user picks
 * Nothing here sends money or messages; it only hands bank / wallet alerts to the app.
 */
@CapacitorPlugin(
    name = "ZayloSms",
    permissions = {
        @Permission(alias = "sms", strings = { Manifest.permission.RECEIVE_SMS }),
        @Permission(alias = "history", strings = { Manifest.permission.READ_SMS })
    }
)
public class ZayloSmsPlugin extends Plugin {
    static volatile ZayloSmsPlugin instance;
    static volatile String sharedText;

    @Override public void load() { instance = this; }
    @Override protected void handleOnDestroy() { if (instance == this) instance = null; }

    void onNewMessages() { notifyListeners("smsReceived", new JSObject()); }

    /** Called by MainActivity when text is shared to Zaylo. */
    public static void receiveShared(String text) {
        sharedText = text;
        if (instance != null) instance.notifyListeners("sharedText", new JSObject());
    }

    private SharedPreferences prefs() { return SecureQueue.prefs(getContext()); }
    private String perm(String alias) {
        PermissionState s = getPermissionState(alias);
        return s == PermissionState.GRANTED ? "granted" : s == PermissionState.DENIED ? "denied" : "prompt";
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject r = new JSObject();
        boolean telephony = getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY_MESSAGING);
        r.put("supported", telephony);
        r.put("permission", perm("sms"));
        r.put("enabled", prefs().getBoolean("enabled", false));
        r.put("paused", prefs().getBoolean("paused", false));
        r.put("pending", SecureQueue.read(getContext()).length());
        long last = prefs().getLong("lastReceivedAt", 0);
        r.put("lastReceivedAt", last > 0 ? iso(last) : null);
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) { JSObject r = new JSObject(); r.put("permission", "granted"); call.resolve(r); return; }
        requestPermissionForAlias("sms", call, "onSmsPermission");
    }
    @PermissionCallback
    private void onSmsPermission(PluginCall call) { JSObject r = new JSObject(); r.put("permission", perm("sms")); call.resolve(r); }

    @PluginMethod
    public void requestHistoryPermission(PluginCall call) {
        if (getPermissionState("history") == PermissionState.GRANTED) { JSObject r = new JSObject(); r.put("permission", "granted"); call.resolve(r); return; }
        requestPermissionForAlias("history", call, "onHistoryPermission");
    }
    @PermissionCallback
    private void onHistoryPermission(PluginCall call) { JSObject r = new JSObject(); r.put("permission", perm("history")); call.resolve(r); }

    /** Turn on / pause / off, and which senders to keep. Turning off also deletes anything waiting. */
    @PluginMethod
    public void configure(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        boolean paused = Boolean.TRUE.equals(call.getBoolean("paused", false));
        Set<String> senders = new HashSet<>();
        JSArray list = call.getArray("senders", new JSArray());
        for (int i = 0; i < list.length(); i++) { String s = SecureQueue.norm(list.optString(i)); if (!s.isEmpty()) senders.add(s); }
        prefs().edit().putBoolean("enabled", enabled).putBoolean("paused", paused).putStringSet("senders", senders).apply();
        if (!enabled) SecureQueue.clear(getContext());
        call.resolve();
    }

    /** Alerts waiting to be processed. They stay until acknowledge() confirms Zaylo handled them. */
    @PluginMethod
    public void drain(PluginCall call) {
        JSONArray q = SecureQueue.read(getContext());
        JSArray out = new JSArray();
        for (int i = 0; i < q.length(); i++) {
            JSONObject o = q.optJSONObject(i);
            JSObject m = new JSObject();
            m.put("id", o.optString("id"));
            m.put("sender", o.optString("sender"));
            m.put("body", o.optString("body"));
            m.put("receivedAt", iso(o.optLong("receivedAtMs")));
            out.put(m);
        }
        JSObject r = new JSObject(); r.put("messages", out); call.resolve(r);
    }

    @PluginMethod
    public void acknowledge(PluginCall call) {
        JSArray ids = call.getArray("ids", new JSArray());
        Set<String> s = new HashSet<>();
        for (int i = 0; i < ids.length(); i++) s.add(ids.optString(i));
        SecureQueue.remove(getContext(), s);
        call.resolve();
    }

    /** One-off import: bank / wallet messages only, between two dates the user chose. */
    @PluginMethod
    public void scanHistory(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) { call.reject("Permission to read past messages wasn't given."); return; }
        long from = call.getLong("from", 0L), to = call.getLong("to", System.currentTimeMillis());
        Set<String> senders = new HashSet<>();
        JSArray list = call.getArray("senders", new JSArray());
        for (int i = 0; i < list.length(); i++) senders.add(SecureQueue.norm(list.optString(i)));
        Set<String> saved = SecureQueue.senders(getContext());
        prefs().edit().putStringSet("senders", senders).apply();   // so the shared filter uses exactly this list
        JSArray out = new JSArray();
        Context ctx = getContext();
        try (Cursor c = ctx.getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI,
                new String[] { Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE },
                Telephony.Sms.DATE + " >= ? AND " + Telephony.Sms.DATE + " <= ?",
                new String[] { String.valueOf(from), String.valueOf(to) }, Telephony.Sms.DATE + " ASC")) {
            while (c != null && c.moveToNext() && out.length() < 2000) {
                String addr = c.getString(1);
                if (!SecureQueue.isFinancialSender(ctx, addr)) continue;      // personal messages are skipped unread
                JSObject m = new JSObject();
                m.put("id", "h" + c.getLong(0));
                m.put("sender", addr);
                m.put("body", c.getString(2));
                m.put("receivedAt", iso(c.getLong(3)));
                out.put(m);
            }
        } catch (Exception e) {
            call.reject("Couldn't read past messages.");
            return;
        } finally {
            if (!saved.isEmpty()) prefs().edit().putStringSet("senders", saved).apply();
        }
        JSObject r = new JSObject(); r.put("messages", out); call.resolve(r);
    }

    @PluginMethod
    public void getSharedText(PluginCall call) {
        JSObject r = new JSObject(); r.put("text", sharedText); sharedText = null; call.resolve(r);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    private static String iso(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date(ms));
    }
}
