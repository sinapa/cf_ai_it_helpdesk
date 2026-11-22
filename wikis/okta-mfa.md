# Okta Verify Push Not Arriving After New Phone
category: identity

## Symptom
Employee upgraded phones and no longer receives Okta Verify push notifications when signing in.

## Self-Service Fix
1. On the Okta login screen, click **Verify with something else** and select **SMS** or **Backup Code**.
2. Visit `https://sso.company.internal/settings`, click **Edit Profile**, remove the old phone under Okta Verify, and scan the new QR code.

## Escalation
If no backup factor is enrolled, contact IT Tier-2 in Slack `#it-help` for a live video ID reset.
