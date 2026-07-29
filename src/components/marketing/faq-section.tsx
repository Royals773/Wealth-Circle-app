import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQS = [
  {
    question: "Does WealthCircle hold or move our group's money?",
    answer:
      "No. WealthCircle is a software-only management system. It does not hold deposits, receive funds, transfer money, distribute money, or initiate withdrawals. Your group keeps its money in its own external bank account, and WealthCircle is used to record and track activity around that account.",
  },
  {
    question: "Can one person belong to more than one group?",
    answer:
      "Yes. A person can belong to multiple groups at once, and can hold a different role in each group they belong to.",
  },
  {
    question: "How do roles and permissions work?",
    answer:
      "Each group defines who is an owner, administrator, treasurer, loan officer, auditor, or ordinary member. Permissions are always tied to a person's membership of that specific group, so the same person can have different access in different groups.",
  },
  {
    question: "How are contributions and repayments verified?",
    answer:
      "Your treasurer records contributions and repayments, and verifies and reconciles them against your group's bank statement. Every reconciled record captures who reconciled it and when.",
  },
  {
    question: "What happens if a record needs to be corrected?",
    answer:
      "Completed financial records are never silently deleted. Corrections are made using a reversal or adjustment record that references the original entry and includes a reason.",
  },
  {
    question: "Is WealthCircle a bank or regulated financial institution?",
    answer:
      "No. WealthCircle does not present itself as a bank, credit union, or provider of investment products, and does not claim any deposit protection or regulatory authorisation. It is a record-keeping and coordination tool that your group uses alongside its own bank account.",
  },
];

export function FaqSection() {
  return (
    <section id="faq" aria-labelledby="faq-heading" className="border-b border-border bg-secondary/30">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <h2 id="faq-heading" className="text-3xl font-semibold tracking-tight text-foreground">
          Frequently asked questions
        </h2>

        <Accordion type="single" collapsible className="mt-10">
          {FAQS.map((faq, index) => (
            <AccordionItem key={faq.question} value={`item-${index}`}>
              <AccordionTrigger className="text-left text-base font-medium">
                {faq.question}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{faq.answer}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
