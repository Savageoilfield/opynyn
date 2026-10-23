# Opynyn goals and checklist

This is a working plan, not a declaration that any data sale or ad use is legally approved. The current app stores a voting cookie and public comments. A pseudonymous identifier can still be personal information. Do not sell row-level votes, comments, identifiers, or behavioral histories simply because names and email addresses are absent.

## Goal 1 — A dependable daily debate and admin workflow

- [x] Publish a daily question, accept one vote per browser cookie, and show results.
- [x] Let visitors comment and reply; retain past debates.
- [x] Provide an account-based admin portal for question editing and scheduling, comment moderation, and aggregate activity counts.
- [x] Require the first admin to replace a generated temporary password.
- [x] Add visitor reporting, a moderation queue, hide/restore controls, and an admin activity log.
- [ ] Add multiple admin roles and an account recovery process.
- [ ] Add backups, restore tests, monitoring, and automated deployment.

## Goal 2 — Measure useful activity with minimal personal data

- [ ] Document every data field, purpose, collection point, retention period, and recipient. Include server/proxy logs, the voting cookie, comments, consent records, and any future ad technology.
- [ ] Get a jurisdiction-specific privacy review before introducing tracking or licensing data. Determine the audience locations and the rules that apply to each.
- [ ] Publish a plain-language privacy notice and contact method. Explain voting cookies, public comments, aggregate reporting, any future analytics, advertising, and data sharing.
- [ ] Design consent and preference controls where required. Keep nonessential analytics and ad tags off until the applicable choice is made; support withdrawal.
- [ ] Build first-party aggregate event counts for page views, vote submissions, shares, and return visits. Do not store raw IP addresses, full user-agent strings, precise location, fingerprinting signals, or cross-site IDs for analytics.
- [ ] Set short retention for raw operational data and a deletion schedule. Provide access/deletion handling where required.
- [ ] Protect reports against re-identification: minimum group sizes, suppression of sparse combinations, coarse dates/categories, and an explicit ban on per-user exports.
- [ ] Review whether debate topics or comments reveal sensitive opinions. Exclude sensitive segments from ad targeting and licensed datasets.

## Goal 3 — License defensible aggregate insights

- [ ] Define the product as aggregated debate trends, not individual profiles or raw responses.
- [ ] Validate the legal basis and consent for each proposed use and recipient. Do not treat pseudonymization as anonymization.
- [ ] Test re-identification risk, especially for small groups or unusual answers, before any export.
- [ ] Create sample reports with thresholds and document their methodology and limitations.
- [ ] Put contracts in place: permitted uses, no re-identification or onward sale, security, retention, deletion, and audit rights.
- [ ] Have counsel approve the notice, consent flow, data processing agreements, and first commercial release.

## Goal 4 — Qualify for Google AdSense

- [ ] Launch on an owned public domain with HTTPS, reliable hosting, and clear navigation.
- [ ] Build a substantial archive of original, useful debate content; avoid thin or duplicated pages.
- [ ] Publish privacy, contact, and community/content rules pages.
- [ ] Moderate user-generated comments and keep policy-violating material off pages with ads.
- [ ] Decide between contextual/non-personalized and personalized ads. Document the different consent and data requirements.
- [ ] Use a Google-certified TCF consent management platform for personalized ads shown in the EEA, UK, or Switzerland, and meet other regional requirements as applicable.
- [ ] Review Google's publisher policies, ad placement rules, invalid-traffic rules, and privacy disclosures before adding ad code.
- [ ] Apply for AdSense only after the site is public and ready for review; add ads.txt and ad code after account approval.
- [ ] Keep ad reporting separate from any licensed dataset and never pass personally identifiable information to Google.

## Policy and regulator references

- [Alberta PIPA overview](https://oipc.ab.ca/overview-privacy-laws/) and [PIPA on a Page](https://oipc.ab.ca/resource/pipa-on-a-page/)
- [Canadian privacy regulator: meaningful consent](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_consent/)
- [EDPB guidance on pseudonymisation](https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf)
- [AdSense eligibility](https://support.google.com/adsense/answer/9724), [publisher policies](https://support.google.com/adsense/answer/10502938), and [user-generated content guidance](https://support.google.com/adsense/answer/3011913)
- [Google's certified CMP requirement](https://support.google.com/adsense/answer/13554116) and [personalized versus non-personalized ads](https://support.google.com/adsense/answer/9007336)
