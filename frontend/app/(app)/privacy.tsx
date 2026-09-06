import { Bullet, LegalScreen, P, Section } from "@/src/components/LegalScreen";

export default function PrivacyPolicy() {
  return (
    <LegalScreen
      title="Privacy Policy"
      eyebrow="Last updated September 2026"
      testID="privacy-policy"
    >
      <Section heading="Information we collect">
        <Bullet>Your email address, display name, and securely hashed password.</Bullet>
        <Bullet>The shifts, notes, and schedule details you choose to save.</Bullet>
        <Bullet>Subscription status and transaction identifiers, but never card details.</Bullet>
        <Bullet>Limited server logs used for reliability and abuse prevention.</Bullet>
      </Section>
      <Section heading="How we use it">
        <P>
          We use this information to provide your account, synchronize your schedule,
          generate exports, confirm Plus access, and support account deletion.
        </P>
        <P>We do not sell personal information or use advertising trackers.</P>
      </Section>
      <Section heading="Payments">
        <P>
          Apple subscriptions are processed by the App Store and validated through
          RevenueCat. Other supported platforms may use their own approved payment
          provider. Foxory never receives your complete payment-card details.
        </P>
      </Section>
      <Section heading="Photos and files">
        <P>
          Schedule photos and Excel files are selected only when you request an import.
          Imported results are shown for review before any shifts are saved.
        </P>
      </Section>
      <Section heading="Retention and your choices">
        <P>
          Your account and schedules remain until you delete them. You can permanently
          delete your account from Legal &amp; Support in Settings.
        </P>
      </Section>
      <Section heading="Contact">
        <P>Privacy: privacy@foxory.info</P>
        <P>Support: support@foxory.info</P>
      </Section>
    </LegalScreen>
  );
}
