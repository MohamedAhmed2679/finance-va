# Google Play submission notes

Text to paste into Play Console. Check each answer against the released build before submitting.
Nothing here is a promise of approval.

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
- **Content rating:** complete the questionnaire; the app has user-to-user chat inside invited
  workspaces only (no public content).

## Reviewer access

Create a review account in the released app (do not reuse a real account), add sample records,
and enter its sign-in details in Play Console → App access. Add these steps:
1. Sign in. Home shows the current cycle.
2. Help (More → Help on phones): guides, Contact support, Report a security concern.
3. Help → Zaylo AI Assistant: ask a question; the permission screen appears first.
4. Settings → AutoTrack: disclosure screen, then the SMS permission.
5. Settings → Security & Privacy → Delete account.
