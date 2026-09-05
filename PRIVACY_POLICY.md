# Foxory Shift Calendar — Privacy Policy

_Last updated: February 2026_

This is a minimal, production-ready privacy policy for the **Foxory Shift Calendar**
mobile app (iOS + Android + Web), operated by **Foxory** ("we", "us", "our"). Host this
page at `https://foxory.info/privacy` and paste the URL into your App Store Connect and
Google Play Console listings.

---

## 1. What we collect

- **Account data**: your email address, chosen display name, and hashed password
  (bcrypt) so you can sign in.
- **Shift plan data**: the shifts (date, type, times, location, note) that you
  create in the app.
- **Payment metadata**: a Ziina `payment_intent_id`, amount, currency and status.
  We **never** see or store your card number, CVV, or bank details — those go
  directly to Ziina's PCI-DSS certified checkout.
- **Diagnostic data**: standard server logs (timestamp, request path, HTTP
  status, IP address) retained for up to 30 days for abuse prevention.

We do **not** collect:
- Contacts, calendar, location, camera, microphone, or advertising identifiers.
- Health, biometric, or medical information.

## 2. How we use it

- To let you sign in, create and manage your draft shift plans.
- To generate XLSX and email exports of your own plan, on your device.
- To determine whether an account is eligible for included access based on its
  verified organization email domain.
- To process paid upgrades via Ziina when you tap **Upgrade to Plus**.

We do **not** sell your personal data, share it with data brokers, or use it for
advertising.

## 3. How data is stored

- Account and shift data is stored in an encrypted MongoDB instance operated on
  our behalf.
- Passwords are stored as bcrypt hashes only — even we cannot see the plain
  text.
- Payment records are stored with the Ziina intent ID, amount, and status; no
  card data ever touches our servers.

## 4. Email

- Draft-plan emails are composed on your device using your own mail app
  (Apple Mail / Gmail / Outlook). Foxory does **not** relay email through a
  third-party service — the email is sent from your own address to your own
  inbox.

## 5. Third-party services

- **Ziina Payment Services LLC** — hosted checkout for the AED 10.99/month Plus
  plan. See [ziina.com/legal](https://ziina.com/legal).

That is the complete list. We do not use analytics SDKs, ad networks, or
crash-reporting SDKs in production builds.

## 6. Data retention & deletion

- Your account and shifts remain until you request deletion.
- To delete your account or download an export of all your data, email
  **support@foxory.info** from the email on file. We will action the request
  within 30 days.

## 7. Children

Foxory Shift Calendar is not directed at children under 13 and does not
knowingly collect data from them. If you believe a child has provided data,
contact us and we will delete it.

## 8. Region-specific rights

- **UAE (PDPL)**: You may access, rectify, or delete your personal data.
- **EU / UK (GDPR)**: You have the rights of access, rectification, erasure,
  restriction, portability, and objection. Our legal basis for processing is
  performance of a contract (the app) and legitimate interest (fraud
  prevention on payments).
- **California (CCPA)**: You have the right to know, delete, and opt out of
  the sale of personal information. We do not sell personal information.

## 9. Changes

If we materially change this policy, we will update the "Last updated" date
above and, when required by law, notify you inside the app.

## 10. Contact

- Email: **privacy@foxory.info**
- Support: **support@foxory.info**
- Postal: Foxory, [add your registered business address]

---

*This document is provided as a template and is not legal advice. If you
process data of EU/UK residents at scale, consult a lawyer before publishing.*
