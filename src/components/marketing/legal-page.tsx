import type { LegalDocument } from "@/lib/legal-content";

export function LegalPage({ doc }: { doc: LegalDocument }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">{doc.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Version {doc.version} · {doc.status} · Effective {doc.effectiveDate}
      </p>

      {doc.intro ? <p className="mt-6 text-sm text-muted-foreground">{doc.intro}</p> : null}

      <div className="mt-10 space-y-8">
        {doc.sections.map((section, i) => (
          <div key={i}>
            {section.heading ? (
              <h2 className="text-lg font-semibold text-foreground">{section.heading}</h2>
            ) : null}
            {(section.paragraphs ?? []).map((p, j) => (
              <p key={j} className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {p}
              </p>
            ))}
            {section.list ? (
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                {section.list.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>
            ) : null}
            {(section.subsections ?? []).map((sub, j) => (
              <div key={j} className="mt-4">
                {sub.heading ? <h3 className="text-sm font-semibold text-foreground">{sub.heading}</h3> : null}
                {sub.paragraphs.map((p, k) => (
                  <p key={k} className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {p}
                  </p>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
