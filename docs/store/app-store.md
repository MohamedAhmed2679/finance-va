# App Store submission notes

Text for App Store Connect. Check each answer against the released build before submitting.
Nothing here is a promise of approval.

## App Privacy ("nutrition label")

All data below is **linked to the user** and **not used for tracking**. Purpose: App Functionality
(Customer Support for the support rows).

| Category | Data type | Notes |
| --- | --- | --- |
| Contact Info | Name, Email Address, Phone Number | Account |
| Financial Info | Other Financial Info | Expenses, income, bills and savings the user enters |
| User Content | Photos or Videos | Receipts, price tags, chat attachments |
| User Content | Audio Data | Voice notes for adding an expense |
| User Content | Customer Support | Support requests and attachments |
| User Content | Other User Content | Workspace chat messages |
| Identifiers | User ID | Account identifier |

The same list is declared in `ios/App/App/PrivacyInfo.xcprivacy`. If a Capacitor plugin is added or
updated, check whether it ships its own privacy manifest and whether new required-reason APIs apply.

**Third-party AI (guideline 5.1.2):** financial summaries, submitted receipts, voice notes and
price-tag photos are sent to Google (Gemini API) only after the user allows it on a screen that
names the provider and lists what is sent. Mention this in App Privacy as data shared with a third
party for App Functionality, and in the review notes below.

## Review notes (paste into "Notes")

Zaylo is a personal expense tracker. It does not hold or move money and has no in-app purchases.

- Sign in with the review account below. Sign in with Apple, Google, Microsoft, email and phone are
  offered.
- AI features are optional. Open Help → Zaylo AI Assistant and send a question: a permission screen
  names the AI provider (Google, Gemini API), lists exactly what is sent, and defaults to
  "Don't allow". Declining leaves the rest of the app fully usable. The choice can be changed in
  Settings → AI and data.
- Account deletion: Settings → Security & Privacy → Delete account. Also described at
  https://zaylo.cc/delete-account
- Bank-alert reading (AutoTrack) from SMS is Android only. On iOS, alerts are added by paste or
  share.
- Support: Help → Contact support. Privacy policy: https://zaylo.cc/privacy

## Before uploading

- [ ] Confirm Sign in with Apple completes in the TestFlight build.
- [ ] Read the four permission texts in Info.plist (camera, microphone, photos, Face ID) on a device.
- [ ] Screenshots from the released build, English and Arabic, 6.9" and 6.5" iPhone sizes.
- [ ] Review account created in the released app with sample records.
- [ ] Support URL and marketing URL on zaylo.cc; a support email on the zaylo.cc domain.
