export const TERMS_OF_SERVICE = `Terms of Service
Last updated: February 2026

1. Acceptance of Terms
By using Russian Video & Text ("the Service"), you agree to these Terms of Service. If you do not agree, do not use the Service.

2. Description of Service
The Service provides tools for watching Russian videos and reading Russian texts with synced transcripts, click-to-translate functionality, and SRS flashcard review. The Service uses third-party APIs (OpenAI, Google Translate) to provide transcription and translation features.

3. User Accounts
You must sign in with a Google account to use the Service. You are responsible for maintaining the security of your account. You may delete your account at any time through the Settings panel.

4. Usage Limits
The Service enforces per-user daily, weekly, and monthly usage limits for API calls (OpenAI and Google Translate). These limits are subject to change.

5. Acceptable Use
You agree not to:
- Use the Service for any illegal purpose
- Attempt to circumvent usage limits or security measures
- Upload or process content that infringes on copyright
- Interfere with or disrupt the Service

6. Content
The Service processes third-party content (videos from ok.ru, texts from lib.ru). We do not claim ownership of this content. You are responsible for ensuring your use of such content complies with applicable laws.

7. Data Storage
Your flashcard deck is stored in Google Firestore. Session data (transcriptions, video segments) is stored temporarily in Google Cloud Storage and automatically deleted after 7 days. You can export your deck data at any time.

8. Disclaimer of Warranties
The Service is provided "as is" without warranties of any kind, express or implied. We do not guarantee accuracy of translations or transcriptions.

9. Limitation of Liability
To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service.

10. Changes to Terms
We may modify these terms at any time. Continued use of the Service after changes constitutes acceptance of the new terms.

11. Termination
We reserve the right to suspend or terminate your access to the Service at any time, for any reason, without notice.`;

export const PRIVACY_POLICY = `Privacy Policy
Last updated: February 2026

1. Information We Collect

Account Information: When you sign in with Google, we receive your name, email address, and profile photo from Google. We store your Google user ID to associate your data.

Usage Data: We track per-user API usage costs (dollar amounts for OpenAI and Google Translate calls) to enforce usage limits. This data is stored in Google Firestore.

Flashcard Data: Words you add to your deck, including the word, translation, example sentence, and review schedule, are stored in Google Firestore associated with your user ID.

Session Data: When you analyze a video or text, we temporarily store transcription data and video/audio segments in Google Cloud Storage. This data is automatically deleted after 7 days.

Error Monitoring: We use Sentry for error tracking. Error reports may include technical information about your browser and the actions that led to the error, but do not include personal content.

2. How We Use Your Information
- To provide the transcription, translation, and flashcard features
- To enforce per-user usage limits
- To monitor and fix errors in the Service
- To improve the Service

3. Data Sharing
We do not sell your personal information. Your data is shared with:
- Google (Firebase Authentication, Firestore, Cloud Storage, Cloud Run)
- OpenAI (text sent for transcription, punctuation, and sentence extraction)
- Google Translate API (words sent for translation)
- Sentry (error reports)

4. Data Retention
- Account data: retained until you delete your account
- Flashcard deck: retained until you delete your account
- Session data: automatically deleted after 7 days
- Usage tracking: resets daily/weekly/monthly per the limit periods

5. Your Rights
You have the right to:
- Export your flashcard data (via the Export button in Settings)
- Delete your account and all associated data (via Settings)
- Access your usage data (visible in Settings)

6. Data Security
We use industry-standard security measures including HTTPS encryption, Firebase Authentication, and Firestore security rules that restrict data access to the owning user.

7. Children's Privacy
The Service is not intended for children under 13. We do not knowingly collect information from children under 13.

8. Changes to This Policy
We may update this Privacy Policy from time to time. We will notify you of material changes by updating the "Last updated" date.

9. Contact
For privacy-related questions, please open an issue on our GitHub repository.`;
