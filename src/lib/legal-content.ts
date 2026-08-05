export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  list?: string[];
  subsections?: { heading: string; paragraphs: string[] }[];
}

export interface LegalDocument {
  title: string;
  version: string;
  status: string;
  effectiveDate: string;
  intro?: string;
  sections: LegalSection[];
}

export const TERMS_OF_USE: LegalDocument = {
  title: "Terms of Use",
  version: "1.0",
  status: "Final Policies",
  effectiveDate: "10 August 2026",
  intro:
    "WealthCircle is a software platform for community savings group administration and record-keeping only. It does not hold, transfer, or control user funds.",
  sections: [
    {
      heading: "1. Introduction",
      paragraphs: [
        "These Terms of Use govern your access to and use of WealthCircle.",
        "By creating an account, accessing the platform, or using any part of it, you agree to be bound by these Terms.",
        "If you do not agree, you must not use the platform.",
      ],
    },
    {
      heading: "2. What WealthCircle does",
      paragraphs: ["WealthCircle is a digital tool that helps community savings groups manage records relating to:"],
      list: ["membership", "contributions", "group rules and governance", "contact details", "notes, reports, and administration"],
    },
    {
      heading: "",
      paragraphs: ["WealthCircle does not:"],
      list: [
        "collect money",
        "hold client funds",
        "transfer funds",
        "pay out funds",
        "operate a wallet or stored-value account",
        "act as a bank, payment institution, e-money issuer, escrow agent, trustee, or money remittance service",
      ],
    },
    {
      heading: "",
      paragraphs: [
        "All money movement between members happens offline and is the sole responsibility of the relevant members and group.",
      ],
    },
    {
      heading: "3. Eligibility and authority",
      paragraphs: [
        "You must be legally capable of entering into a binding contract in your jurisdiction to use the platform.",
        "If you use WealthCircle on behalf of a group, you confirm that you have authority to do so.",
        "If you are an administrator, you confirm that the group has authorised you to manage its account and records.",
      ],
    },
    {
      heading: "4. Account registration and security",
      paragraphs: ["You must provide accurate, complete, and current information when registering.", "You are responsible for:"],
      list: [
        "keeping your login details secure",
        "all activity carried out using your account",
        "notifying us promptly if you suspect unauthorised access or misuse",
      ],
    },
    {
      heading: "",
      paragraphs: [
        "We may require additional verification before granting access, changing account details, or restoring an account.",
      ],
    },
    {
      heading: "5. Group records and user responsibility",
      paragraphs: ["WealthCircle is a record-keeping tool only.", "Each user and each group is responsible for:"],
      list: [
        "the accuracy of data entered into the platform",
        "verifying offline cash contributions and repayments",
        "deciding and enforcing group rules",
        "resolving internal disputes",
        "ensuring their own use of the platform is lawful",
      ],
    },
    {
      heading: "",
      paragraphs: ["We do not verify whether any offline payment was made unless we expressly state otherwise in writing."],
    },
    {
      heading: "6. Permitted use",
      paragraphs: [
        "You may use the platform only for lawful administration of genuine community savings groups or similar self-organising groups.",
      ],
    },
    {
      heading: "7. Prohibited use",
      paragraphs: ["You must not:"],
      list: [
        "use the platform unlawfully or fraudulently",
        "upload false or misleading records",
        "impersonate another person",
        "access or attempt to access another user's data without permission",
        "interfere with the security or operation of the platform",
        "use the platform to facilitate money laundering, fraud, or other criminal activity",
        "upload unlawful, abusive, discriminatory, defamatory, or harmful content",
      ],
    },
    {
      heading: "8. Service availability",
      paragraphs: [
        "We aim to provide a reliable service, but we do not guarantee uninterrupted or error-free access.",
        "We may suspend, restrict, or change the platform where reasonably necessary for maintenance, security, legal compliance, or operational reasons.",
      ],
    },
    {
      heading: "9. Fees",
      paragraphs: [
        "If fees apply, they will be shown separately on the platform or in a pricing schedule.",
        "We may change our fees on reasonable notice.",
      ],
    },
    {
      heading: "10. Intellectual property",
      paragraphs: [
        "We and our licensors own the platform, software, branding, and all related intellectual property rights.",
        "You are granted a limited, non-exclusive, non-transferable right to use the platform for its intended purpose during the term of your account.",
      ],
    },
    {
      heading: "11. User content and data",
      paragraphs: [
        "You remain responsible for the content and data you upload.",
        "You must only upload personal data you are authorised to provide.",
        "Our handling of personal data is described in our Privacy Policy.",
      ],
    },
    {
      heading: "12. No financial advice or assurance",
      paragraphs: [
        "WealthCircle does not provide financial, legal, tax, accounting, or investment advice.",
        "Nothing in the platform should be treated as a guarantee, recommendation, or assurance about any financial arrangement within a group.",
      ],
    },
    {
      heading: "13. Disclaimers",
      paragraphs: ["To the fullest extent permitted by law, we disclaim responsibility for:"],
      list: [
        "offline cash handling between users",
        "group disputes or governance outcomes",
        "errors in user-entered data",
        "missed contributions, late payments, or repayment disputes",
        "any reliance placed on the platform as proof of payment unless expressly agreed in writing",
      ],
    },
    {
      heading: "14. Liability",
      paragraphs: [
        "Nothing in these terms limits liability that cannot lawfully be limited.",
        "Subject to that, we are not liable for indirect or consequential loss, loss of profit, loss of goodwill, loss of business, or loss of opportunity.",
        "Where liability cannot be excluded, it is limited to the maximum extent permitted by law and, where appropriate, to the fees paid by you in the previous 12 months.",
      ],
    },
    {
      heading: "15. Suspension and termination",
      paragraphs: ["We may suspend or terminate access if we reasonably believe:"],
      list: ["you have breached these Terms", "your account poses a security or legal risk", "the platform is being used unlawfully"],
    },
    {
      heading: "",
      paragraphs: ["You may stop using the platform at any time."],
    },
    {
      heading: "16. Changes to these terms",
      paragraphs: [
        "We may update these Terms from time to time.",
        "Where changes are material, we will take reasonable steps to notify users.",
      ],
    },
    {
      heading: "17. Governing law and jurisdiction",
      subsections: [
        {
          heading: "17.1 Governing law",
          paragraphs: [
            "This Agreement and any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with it or its subject matter or formation shall be governed by and construed in accordance with the laws of England and Wales and, to the extent mandatory local law applies to services performed or delivered in Ghana, the laws of the Republic of Ghana.",
          ],
        },
        {
          heading: "17.2 Jurisdiction – UK transactions",
          paragraphs: [
            "Subject to clause 17.4, the parties irrevocably agree that the courts of England and Wales shall have exclusive jurisdiction to settle any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with this Agreement where the Customer is established in, or the services are primarily delivered within, the United Kingdom.",
          ],
        },
        {
          heading: "17.3 Jurisdiction – Ghana transactions",
          paragraphs: [
            "Subject to clause 17.4, where the Customer is established in, or the services are primarily delivered within, the Republic of Ghana, the parties irrevocably agree that the courts of Ghana shall have exclusive jurisdiction to settle any dispute or claim (including non-contractual disputes or claims) arising out of or in connection with this Agreement, and this Agreement shall be governed by and construed in accordance with the laws of the Republic of Ghana.",
          ],
        },
        {
          heading: "17.4 Arbitration option for cross-border disputes",
          paragraphs: [
            "For any dispute arising out of or in connection with this Agreement that involves parties or services in both the United Kingdom and Ghana, the parties may agree in writing that such dispute shall be finally resolved by arbitration under the Rules of the London Court of International Arbitration (LCIA), which rules are deemed to be incorporated by reference into this clause. The seat, or legal place, of arbitration shall be London, England. The language of the arbitration shall be English.",
          ],
        },
        {
          heading: "17.5 Mandatory local laws",
          paragraphs: [
            "Nothing in this clause 17 shall prevent either party from seeking interim, conservatory, or injunctive relief in any court of competent jurisdiction, nor shall it operate to exclude or limit the application of any mandatory laws or regulatory requirements applicable to the provision of health or care services in the United Kingdom or Ghana.",
          ],
        },
      ],
    },
    {
      heading: "18. Contact",
      paragraphs: ["WealthCircle App"],
      list: ["Support contact email: to be confirmed before launch", "Registered address: to be added on incorporation"],
    },
  ],
};

export const PRIVACY_POLICY: LegalDocument = {
  title: "Privacy Policy",
  version: "1.0",
  status: "Final Policies",
  effectiveDate: "10 August 2026",
  sections: [
    {
      heading: "1. Who we are",
      paragraphs: [
        "WealthCircle is a digital platform for community savings group administration and record-keeping.",
        "For the purposes of applicable data protection laws, we are the data controller for the personal data we collect and process for our own service operations, unless we act as a processor for a specific customer arrangement.",
      ],
    },
    {
      heading: "2. Personal data we collect",
      paragraphs: ["We may collect the following personal data:"],
      list: [
        "full name",
        "date of birth",
        "phone number",
        "email address",
        "residential address",
        "next-of-kin or emergency contact details",
        "group membership information",
        "contribution and administration records",
        "login credentials and authentication data",
        "device, browser, and usage information",
        "support communications",
        "security and audit logs",
      ],
    },
    {
      heading: "3. How we use personal data",
      paragraphs: ["We use personal data to:"],
      list: [
        "create and manage user accounts",
        "provide the platform and its features",
        "administer group records",
        "authenticate users and protect accounts",
        "provide customer support",
        "detect, investigate, and prevent fraud or misuse",
        "maintain security and service integrity",
        "comply with legal and regulatory obligations",
        "improve and troubleshoot the service",
      ],
    },
    {
      heading: "4. Lawful bases for processing",
      paragraphs: [
        "WealthCircle processes personal data on a lawful basis in accordance with UK GDPR. The specific lawful basis applicable to each processing activity is being finalised as part of our ongoing legal review ahead of full launch, and this section will be updated to confirm it once settled. In general terms, and subject to that confirmation, we expect to rely on one or more of the following:",
      ],
      list: ["performance of a contract", "legitimate interests", "legal obligation", "consent, where required for optional processing"],
    },
    {
      heading: "",
      paragraphs: [
        "Where we process special category data or criminal offence data, we will only do so where a valid additional condition applies.",
      ],
    },
    {
      heading: "5. Next-of-kin data",
      paragraphs: [
        "If you provide next-of-kin or emergency contact details, you confirm that you have authority to provide that information and, where appropriate, that the person has been informed their details may be stored and used for the stated purpose.",
        "We use next-of-kin data only for emergency or contact purposes and keep access limited to authorised personnel and relevant administrators where needed.",
      ],
    },
    {
      heading: "6. Sharing personal data",
      paragraphs: ["We may share personal data with:"],
      list: [
        "cloud hosting and infrastructure providers",
        "software vendors that help us operate the platform",
        "analytics and security providers",
        "support and communications tools",
        "professional advisers",
        "regulators, courts, or law enforcement where required by law",
      ],
    },
    {
      heading: "",
      paragraphs: ["We do not sell personal data."],
    },
    {
      heading: "7. International transfers",
      paragraphs: [
        "Your personal data may be processed in countries outside the country in which you live, including the UK, Ghana, and other countries where our service providers operate.",
        "Where required by law, we use appropriate transfer safeguards.",
      ],
    },
    {
      heading: "8. Retention",
      paragraphs: [
        "We retain your personal data for as long as you remain a member of a savings group on WealthCircle. Where you leave a group, or your account is closed, we retain your personal data for a defined further period to meet legal, accounting, and dispute-resolution obligations, after which it is securely deleted or anonymised. The exact retention period following departure or account closure is being finalised ahead of full launch and will be confirmed and stated here once settled.",
        "Further detail on our approach to retention and deletion is set out in our internal Retention and Deletion Policy, available on request.",
      ],
    },
    {
      heading: "9. Your rights",
      paragraphs: ["Depending on where you live and which laws apply, you may have rights to:"],
      list: [
        "access your personal data",
        "correct inaccurate data",
        "request deletion",
        "object to or restrict processing",
        "request portability",
        "withdraw consent where consent is the basis relied on",
      ],
    },
    {
      heading: "10. Security",
      paragraphs: [
        "We use reasonable technical and organisational measures to protect personal data, including access controls, audit logging, and security monitoring.",
        "No system is perfectly secure, but we work to protect your data from unauthorised access, loss, misuse, or disclosure.",
      ],
    },
    {
      heading: "11. Data breaches",
      paragraphs: ["If a personal data breach occurs, we will respond in line with applicable law and our incident response procedures."],
    },
    {
      heading: "12. Complaints",
      paragraphs: [
        "If you have a concern, please contact us first so we can try to resolve it.",
        "If you are in the UK, you may also complain to the Information Commissioner's Office. If you are in Ghana, you may also have rights under the Data Protection Commission framework.",
      ],
    },
    {
      heading: "13. Changes to this policy",
      paragraphs: ["We may update this Privacy Policy from time to time. We will post the updated version when changes are made."],
    },
    {
      heading: "14. Contact details",
      paragraphs: ["WealthCircle App"],
      list: ["Privacy contact email: to be confirmed before launch", "Registered address: to be added on incorporation"],
    },
  ],
};

export const COOKIE_POLICY: LegalDocument = {
  title: "Cookie Policy",
  version: "1.0",
  status: "Final Policies",
  effectiveDate: "10 August 2026",
  sections: [
    {
      heading: "1. What cookies are",
      paragraphs: ["Cookies are small text files stored on your device when you visit a website or use certain online services."],
    },
    {
      heading: "2. How we use cookies",
      paragraphs: ["We may use cookies and similar technologies for:"],
      list: [
        "strict website functionality",
        "authentication and session management",
        "security and fraud prevention",
        "remembering preferences",
        "analytics, if enabled",
        "improving site performance",
      ],
    },
    {
      heading: "3. Types of cookies we may use",
      subsections: [
        { heading: "Strictly necessary cookies", paragraphs: ["These cookies are required for the website or app to function properly."] },
        { heading: "Preference cookies", paragraphs: ["These help us remember your settings or choices."] },
        { heading: "Analytics cookies", paragraphs: ["These help us understand how the service is used so we can improve it."] },
        { heading: "Functional cookies", paragraphs: ["These support enhanced features or service integrations."] },
      ],
    },
    {
      heading: "4. Consent",
      paragraphs: [
        "Where non-essential cookies are used, we will seek consent before placing them on your device where required by law.",
        "You can withdraw or change your cookie choices at any time using the relevant cookie settings, where available.",
      ],
    },
    {
      heading: "5. Third-party cookies",
      paragraphs: [
        "Some cookies may be placed by third-party service providers that help us operate the platform.",
        "The specific cookies used will depend on the technologies actually enabled on the service.",
      ],
    },
    {
      heading: "6. Managing cookies",
      paragraphs: ["You can control cookies through your browser settings.", "Blocking some cookies may affect how the service works."],
    },
    {
      heading: "7. Changes to this policy",
      paragraphs: ["We may update this Cookie Policy if our use of cookies changes."],
    },
  ],
};

export const ACCEPTABLE_USE_POLICY: LegalDocument = {
  title: "Acceptable Use Policy",
  version: "1.0",
  status: "Final Policies",
  effectiveDate: "10 August 2026",
  sections: [
    {
      heading: "1. Purpose",
      paragraphs: ["This policy sets out the rules for acceptable use of WealthCircle."],
    },
    {
      heading: "2. Permitted use",
      paragraphs: [
        "You may use WealthCircle only for lawful group administration, record-keeping, and related communication for genuine community savings groups or similar self-organising groups.",
      ],
    },
    {
      heading: "3. Prohibited use",
      paragraphs: ["You must not use the platform to:"],
      list: [
        "commit fraud or enable fraud",
        "falsify contributions, payouts, membership, or governance records",
        "access another user's account or data without permission",
        "upload malware or interfere with system security",
        "harass, threaten, abuse, or defame others",
        "promote unlawful activity",
        "use the service in a way that infringes another person's rights",
      ],
    },
    {
      heading: "4. Content standards",
      paragraphs: [
        "Content submitted to the platform must be lawful and must not be misleading, obscene, hateful, discriminatory, or otherwise harmful.",
      ],
    },
    {
      heading: "5. Enforcement",
      paragraphs: [
        "We may remove content, suspend accounts, restrict access, or terminate accounts if we reasonably believe this policy has been breached.",
      ],
    },
    {
      heading: "6. Reporting concerns",
      paragraphs: ["Users should report suspected misuse, fraud, or security issues to us promptly."],
    },
  ],
};
