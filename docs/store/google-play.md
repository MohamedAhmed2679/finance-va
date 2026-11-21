# Google Play submission notes

Text to paste into Play Console. Check each answer against the released build before submitting.
Nothing here is a promise of approval.

## Release builds and installing on your own phone

**Why a downloaded APK won't install.** Google Play Protect blocks any app that is installed from a
browser, chat app or file manager and asks for SMS permissions (READ_SMS, RECEIVE_SMS). This is an
anti-fraud rule, so an appeal doesn't lift it for sideloaded files. Debug builds also carry a
throwaway signature that changes with every CI run, so one can't update another. Test through
Play's **Internal testing** track instead (or `adb install` from a computer).

**One-time setup: the upload key.** Create this on your own computer; it never goes into git.
```
keytool -genkeypair -v -keystore zaylo-upload.jks -alias zaylo-upload -keyalg RSA -keysize 4096 -validity 10000
```
Keep the file and both passwords in a password manager: losing them means asking Google to reset
the upload key. Then add four repository secrets (GitHub → Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `ZAYLO_UPLOAD_KEYSTORE_BASE64` | the .jks file as base64 (`base64 -w0 zaylo-upload.jks`, or on Windows `[Convert]::ToBase64String([IO.File]::ReadAllBytes("zaylo-upload.jks"))`) |
| `ZAYLO_KEYSTORE_PASSWORD` | the keystore password |
| `ZAYLO_KEY_ALIAS` | `zaylo-upload` |
| `ZAYLO_KEY_PASSWORD` | the key password |

With the secrets in place, every build on main produces a signed `Zaylo-android.apk` (public
test-build release) and a signed `Zaylo-android.aab` (the private `play-bundle` artifact of that
workflow run). versionCode is 1000 + the run number, so each upload is higher than the last.
For a local release build, put the same four values in `android/keystore.properties`
(`storeFile`, `storePassword`, `keyAlias`, `keyPassword`); that file is git-ignored.

**First upload.** Play Console → Create app → Test and release → Internal testing → Create release.
Accept Play App Signing (Google holds the app signing key; yours is only the upload key) and upload
the .aab. Add your Google account as a tester, open the opt-in link on the phone, and install from
Play. Uninstall any earlier sideloaded Zaylo first: it has a different signature.

## Permissions declaration: SMS (READ_SMS, RECEIVE_SMS)

**Core functionality category:** SMS-based money management (budgeting and expense tracking from
financial transaction SMS).

**Why the app needs it (for the form):**
Zaylo is a personal expense tracker. AutoTrack, an optional feature that is off until the user sets
it up, reads incoming SMS from banks and mobile wallets on the device and turns transaction alerts
(purchases, withdrawals, deposits, bill payments) into draft expense or income records for the user
to review. Without SMS access the user must retype every alert by hand.

**How the access is limited:**
- Requested only when the user turns AutoTrack on, after an in-app disclosure screen that states
  what is read and why. The rest of the app works if the user declines.
- Only messages from senders recognised as banks or wallets (or senders the user adds) are kept.
  Other messages are ignored and never stored.
- One-time passwords and security codes are never read into the app, stored or sent anywhere.
- Messages are processed on the device. Message text is sent to Zaylo's servers only as the draft
  record the user sees. Optional "AI reading" of an unrecognised bank alert is a separate switch
  with its own consent; account numbers are masked before sending.
- SMS data is not used for advertising, is not sold, and is not shared with third parties other
  than the AI provider under the optional consent above.
- The user can turn AutoTrack off in Settings at any time, which stops all reading.

**Demo video for the declaration:** record the flow Settings → AutoTrack → disclosure screen →
Allow → a bank SMS arriving → the draft appearing in the AutoTrack inbox.

**Risk:** Google reviews this declaration by hand and can refuse it. If it is refused, the fallback
is a build without the two permissions; paste, share-to-Zaylo and forwarding keep working.

## Data safety form

| Data type | Collected | Shared | Purpose | Optional |
| --- | --- | --- | --- | --- |
| Name, email address, phone number | Yes | No | Account management, app functionality | Required (one of email or phone) |
| User IDs | Yes | No | App functionality | Required |
| Financial info: purchase history, other financial info (expenses, income, bills, savings the user enters) | Yes | Yes, with the AI provider (Google, Gemini API), only if the user allows AI features | App functionality | AI sharing is optional |
| SMS messages (bank and wallet alerts only) | Yes | Only under the optional AI reading consent | App functionality | Optional |
| Photos (receipts, price tags, chat attachments) | Yes | Receipts and price tags with the AI provider when the user submits them for reading | App functionality | Optional |
| Voice recordings (voice notes for adding an expense) | Yes | With the AI provider when submitted | App functionality | Optional |
| Messages in the app (workspace chat, support requests) | Yes | No | App functionality, customer support | Optional |
| App diagnostics (device, app version, sent with a support request) | Yes | No | Customer support | Optional, shown before sending |

- Data is encrypted in transit: **Yes**.
- Users can request that data is deleted: **Yes**. URL: https://zaylo.cc/delete-account
- Advertising or tracking: **None**. The app has no advertising or analytics SDK.

## Other declarations

- **Financial features:** personal budgeting and expense tracking only. No loans, no money
  transfer, no payments, no investment, no crypto.
- **AI-generated content:** the assistant's answers can be reported from each answer (flag icon).
  Reports reach the Zaylo team.
- **Privacy policy URL:** https://zaylo.cc/privacy
- **Target API level:** 36.
- **Exact alarms:** not requested (removed from the manifest); reminders use ordinary alarms.
- **Backups:** Android backup is off for the app; account data lives in the user's Zaylo account.
- **Content rating:** complete the questionnaire; the app has user-to-user chat inside invited
  workspaces only (no public content).

## Reviewer access

Create a review account in the released app (do not reuse a real account), add sample records,
and enter its sign-in details in Play Console → App access. Use email and password (not Google
sign-in) and leave two-step verification off on that account, or the reviewer can't get in. Add these steps:
1. Sign in. Home shows the current cycle.
2. Help (More → Help on phones): guides, Contact support, Report a security concern.
3. Help → Zaylo AI Assistant: ask a question; the permission screen appears first.
4. Settings → AutoTrack: disclosure screen, then the SMS permission.
5. Settings → Security & Privacy → Delete account.
