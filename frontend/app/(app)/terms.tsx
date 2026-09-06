import { LegalScreen, P, Section } from "@/src/components/LegalScreen";

export default function TermsOfService() {
  return (
    <LegalScreen
      title="Terms of Service"
      eyebrow="Last updated September 2026"
      testID="terms-of-service"
    >
      <Section heading="Using Foxory">
        <P>
          Foxory Shift Calendar is a personal planning tool. Keep your sign-in details
          secure and use the app only for lawful purposes.
        </P>
      </Section>
      <Section heading="Schedule accuracy">
        <P>
          Imported and manually entered schedules must be reviewed by you. Foxory is not
          a clinical staffing system, employer record, or substitute for your official
          workplace schedule.
        </P>
      </Section>
      <Section heading="Foxory Plus">
        <P>
          On iPhone and iPad, Plus is an auto-renewing monthly subscription billed to
          your Apple ID. The App Store displays the final local price before purchase.
          It renews unless canceled at least 24 hours before the end of the current
          period. You can manage or cancel it in your App Store account settings.
        </P>
        <P>
          Restore Purchases is available on the Upgrade screen. Refunds and billing
          disputes for App Store purchases are handled under Apple&apos;s policies.
        </P>
      </Section>
      <Section heading="Availability">
        <P>
          We aim to keep the service available, but temporary interruptions can occur.
          The app is provided without a guarantee that it will meet every scheduling or
          regulatory requirement.
        </P>
      </Section>
      <Section heading="Account termination">
        <P>
          You may delete your account in Settings. We may suspend accounts used for
          abuse, fraud, or attempts to interfere with the service.
        </P>
      </Section>
      <Section heading="Contact">
        <P>support@foxory.info</P>
      </Section>
    </LegalScreen>
  );
}
