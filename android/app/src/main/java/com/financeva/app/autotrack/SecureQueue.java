package com.financeva.app.autotrack;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.HashSet;
import java.util.Set;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Bank / wallet alerts waiting for Zaylo to process them, kept in app-private storage and encrypted
 * with an AES-GCM key that never leaves the Android Keystore. Items are removed as soon as Zaylo
 * confirms it handled them, and anything older than 14 days is dropped.
 */
public final class SecureQueue {
    private static final String PREFS = "zaylo_autotrack";
    private static final String KEY_ALIAS = "zaylo_autotrack_queue_v1";
    private static final String QUEUE = "queue";
    private static final int MAX_ITEMS = 200;
    private static final long MAX_AGE_MS = 14L * 24 * 60 * 60 * 1000;

    private SecureQueue() {}

    public static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        g.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build());
        return g.generateKey();
    }

    private static String encrypt(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = c.getIV();
        byte[] out = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(out, Base64.NO_WRAP);
    }

    private static String decrypt(String stored) throws Exception {
        String[] p = stored.split(":", 2);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(p[0], Base64.NO_WRAP)));
        return new String(c.doFinal(Base64.decode(p[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    public static synchronized JSONArray read(Context ctx) {
        String s = prefs(ctx).getString(QUEUE, null);
        if (s == null) return new JSONArray();
        try {
            JSONArray all = new JSONArray(decrypt(s));
            JSONArray fresh = new JSONArray();
            long now = System.currentTimeMillis();
            for (int i = 0; i < all.length(); i++) {
                JSONObject o = all.getJSONObject(i);
                if (now - o.optLong("receivedAtMs", now) <= MAX_AGE_MS) fresh.put(o);
            }
            return fresh;
        } catch (Exception e) {
            // unreadable (e.g. the key was reset): drop it rather than keep data we can't protect
            prefs(ctx).edit().remove(QUEUE).apply();
            return new JSONArray();
        }
    }

    private static void write(Context ctx, JSONArray a) {
        try {
            if (a.length() == 0) { prefs(ctx).edit().remove(QUEUE).apply(); return; }
            prefs(ctx).edit().putString(QUEUE, encrypt(a.toString())).apply();
        } catch (Exception ignored) { /* nothing is kept if it can't be encrypted */ }
    }

    public static synchronized void add(Context ctx, JSONObject item) {
        JSONArray a = read(ctx);
        String id = item.optString("id");
        for (int i = 0; i < a.length(); i++) if (id.equals(a.optJSONObject(i).optString("id"))) return; // same message twice
        a.put(item);
        while (a.length() > MAX_ITEMS) a.remove(0);
        write(ctx, a);
    }

    public static synchronized void remove(Context ctx, Set<String> ids) {
        JSONArray a = read(ctx), keep = new JSONArray();
        for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (!ids.contains(o.optString("id"))) keep.put(o); }
        write(ctx, keep);
    }

    public static synchronized void clear(Context ctx) { prefs(ctx).edit().remove(QUEUE).apply(); }

    // ── which senders to keep (normalised like the app: lower case, no spaces, dots or underscores)
    public static String norm(String s) { return s == null ? "" : s.toLowerCase().replaceAll("[\\s_.]", ""); }

    public static Set<String> senders(Context ctx) { return new HashSet<>(prefs(ctx).getStringSet("senders", new HashSet<>())); }

    public static boolean isFinancialSender(Context ctx, String sender) {
        String s = norm(sender);
        if (s.isEmpty() || s.matches("^\\+?\\d{6,}$")) return false;   // a phone number is a person
        for (String m : senders(ctx)) {
            if (m.isEmpty()) continue;
            if (s.equals(m)) return true;
            if (m.length() >= 3 && s.startsWith(m) && s.length() - m.length() <= 8) return true;
        }
        return false;
    }
}
