// The research paper library behind "how'z that!": the list (with search and filters), one page per paper,
// and the integrated paper with PDF export. Paper content lives in ./research/*.md (see research/README.md).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DETAIL_LAYOUT,
  KNOWN_HEADINGS,
  STUB_SECTION,
  citation,
  loadResearch,
  searchText,
  sectionBody,
  shortAuthors,
  usedInBuild,
  type Paper,
  type PaperStatus,
} from "./research";
import { Link, researchPath } from "./router";
import { Eyebrow, Markdown, StatusPill, linkClass, type PillKind } from "./howzthat/ui";

// Every markdown file in ./research becomes a page. Adding a paper = adding a file.
const files = import.meta.glob("./research/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
export const { papers, integrated } = loadResearch(files);
export const bySlug = new Map(papers.map((p) => [p.slug, p]));
export const builtPapers = papers.filter(usedInBuild);
export const readingList = papers.filter((p) => !usedInBuild(p));

export const paperLabel = (slug: string) => {
  const p = bySlug.get(slug);
  return p ? `${shortAuthors(p.authors)} (${p.year})` : null;
};

export const paperPill = (status: PaperStatus): PillKind => (status === "planned" ? "reading" : status);

const chip = "rounded-full border px-2 py-0.5 text-[10px] font-semibold";

function TrustBadges({ paper }: { paper: Paper }) {
  return (
    <>
      {!paper.reviewed && (
        <span className={`${chip} border-amber-500/25 text-amber-200`} title="No teammate has signed this page off yet">
          Draft · needs team review
        </span>
      )}
      {!paper.citationVerified && (
        <span className={`${chip} border-slate-600 text-slate-400`} title="Check against the publisher page before citing">
          Citation not yet checked
        </span>
      )}
    </>
  );
}

// ---- library ---------------------------------------------------------------------------------------

type AreaFilter = "all" | "systems" | "behavioral";
type StatusFilter = "all" | "implemented" | "partial" | "planned";

function FilterGroup<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-1">
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`cursor-pointer rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${value === id ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function PaperCard({ paper }: { paper: Paper }) {
  return (
    <li>
      <Link
        to={researchPath.paper(paper.slug)}
        data-testid="paper-card"
        className="group flex h-full flex-col rounded-xl border border-slate-800 bg-slate-900/60 p-4 transition hover:border-cyan-500/40 hover:bg-slate-900"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill kind={paperPill(paper.status)} />
          {!paper.reviewed && <span className={`${chip} border-amber-500/25 text-amber-200`}>Draft</span>}
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-slate-500">{paper.area === "behavioral" ? "Behavioural" : "Systems"}</span>
        </div>
        <div className="mt-3 text-sm font-semibold leading-snug text-white group-hover:text-cyan-200">{paper.title}</div>
        <div className="mt-1 text-xs text-slate-500">
          {shortAuthors(paper.authors)} · {paper.year}
          {paper.venue && <> · {paper.venue.split(/[,(]/)[0].trim()}</>}
        </div>
        {paper.summary && <p className="mt-2 text-xs leading-relaxed text-slate-400">{paper.summary}</p>}
        <span className="mt-auto pt-3 text-[11px] font-semibold text-cyan-300">Open paper page →</span>
      </Link>
    </li>
  );
}

export function PaperLibrary() {
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<AreaFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const index = useMemo(() => new Map(papers.map((p) => [p.slug, searchText(p)])), []);

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (p: Paper) =>
    (area === "all" || p.area === area) &&
    (status === "all" || p.status === status) &&
    terms.every((t) => index.get(p.slug)?.includes(t));
  const built = builtPapers.filter(match);
  const reading = readingList.filter(match);
  const total = built.length + reading.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search papers</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search title, author, idea or file…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-cyan-500/60 focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <FilterGroup label="Research area" value={area} onChange={setArea} options={[["all", "All areas"], ["systems", "Systems"], ["behavioral", "Behavioural"]]} />
          <FilterGroup label="Implementation status" value={status} onChange={setStatus} options={[["all", "Any status"], ["implemented", "Implemented"], ["partial", "Partial"], ["planned", "Reading list"]]} />
        </div>
      </div>
      <p className="text-xs text-slate-500" aria-live="polite">
        {total} of {papers.length} papers
        {(query || area !== "all" || status !== "all") && (
          <>
            {" · "}
            <button type="button" className="cursor-pointer text-cyan-300 underline underline-offset-2" onClick={() => { setQuery(""); setArea("all"); setStatus("all"); }}>
              clear filters
            </button>
          </>
        )}
      </p>

      {built.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-200">Papers behind what we built <span className="font-normal text-slate-500">· {built.length}</span></h3>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {built.map((p) => (
              <PaperCard key={p.slug} paper={p} />
            ))}
          </ul>
        </div>
      )}
      {reading.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Reading list <span className="font-normal text-slate-500">· {reading.length}</span></h3>
          <p className="mb-3 mt-1 text-xs text-slate-500">For planned features. Nobody on the team has read these deeply yet, so their pages make no claims and their citations are not yet checked.</p>
          <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800">
            {reading.map((p) => (
              <li key={p.slug}>
                <Link to={researchPath.paper(p.slug)} className="flex flex-col gap-1 px-4 py-3 text-xs transition hover:bg-slate-800/50 sm:flex-row sm:items-baseline sm:gap-3">
                  <span className="font-semibold text-slate-200">{p.title}</span>
                  <span className="text-slate-500">{shortAuthors(p.authors)} · {p.year}</span>
                  <span className="text-slate-400 sm:ml-auto sm:max-w-sm sm:text-right">{p.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {total === 0 && <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">No paper matches those filters.</p>}

      {integrated && (
        <Link to={researchPath.integrated} className="flex flex-col gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 transition hover:border-cyan-400/60 sm:flex-row sm:items-center sm:justify-between">
          <span>
            <Eyebrow className="text-cyan-300">Integrated paper · draft</Eyebrow>
            <span className="mt-1 block text-sm font-semibold text-white">{integrated.title}</span>
            <span className="mt-1 block text-xs text-slate-400">The library as one paper: abstract, design, implementation, evaluation, limitations and references. Exportable as PDF.</span>
          </span>
          <span className="shrink-0 text-xs font-semibold text-cyan-300">Read the integrated paper →</span>
        </Link>
      )}
    </div>
  );
}

// ---- one paper -----------------------------------------------------------------------------------

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-slate-800 px-5 py-4 md:grid-cols-[14rem_1fr] md:gap-6">
      <h3 className="text-xs font-semibold text-slate-400">{label}</h3>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const notWritten = <p className="text-sm italic text-slate-500">Not written yet.</p>;

const STATUS_TEXT: Record<PaperStatus, string> = {
  implemented: "The idea is in the code today. See the code references and the evidence below for exactly what was built and how it was checked.",
  partial: "Part of the idea is in the code; the rest is planned. The sections below say which part.",
  planned: "Nothing from this paper is built yet.",
  rejected: "We decided not to use this idea. The reasons are below.",
};

export function PaperDetail({ paper }: { paper: Paper }) {
  const isStub = !usedInBuild(paper);
  const extra = paper.sections.filter((s) => !KNOWN_HEADINGS.has(s.heading.toLowerCase()));
  const i = papers.indexOf(paper);
  const prev = papers[i - 1];
  const next = papers[i + 1];
  const doiHref = paper.doi ? `https://doi.org/${paper.doi}` : "";

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
      <header className="space-y-3 px-5 py-6">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill kind={paperPill(paper.status)} />
          <TrustBadges paper={paper} />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{paper.area === "behavioral" ? "Behavioural finance" : "Systems"}</span>
        </div>
        <h1 className="max-w-4xl text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl">{paper.title}</h1>
        <p className="text-sm text-slate-300">{paper.authors}</p>
        <p className="max-w-4xl text-xs leading-relaxed text-slate-400">{citation(paper)}</p>
        <div className="flex flex-wrap gap-4 text-xs">
          {doiHref ? (
            <a href={doiHref} target="_blank" rel="noreferrer" className={linkClass}>Original publication · doi:{paper.doi}</a>
          ) : (
            <span className="text-slate-500">No verified publication link yet</span>
          )}
          {paper.url && <a href={paper.url} target="_blank" rel="noreferrer" className={linkClass}>Readable copy</a>}
        </div>
      </header>

      {isStub ? (
        <>
          <DetailRow label={STUB_SECTION}>{sectionBody(paper, STUB_SECTION) ? <Markdown text={sectionBody(paper, STUB_SECTION)!} paperLabel={paperLabel} /> : notWritten}</DetailRow>
          <DetailRow label="Implementation status">
            <p className="text-sm text-slate-300">{STATUS_TEXT.planned}</p>
          </DetailRow>
          <div className="border-t border-slate-800 px-5 py-4 text-xs text-slate-400">
            On the reading list: nobody on the team has read this paper deeply yet, so this page makes no claims about its method or findings.
          </div>
        </>
      ) : (
        DETAIL_LAYOUT.map((row) => {
          if (row.special === "relevance") {
            return <DetailRow key={row.label} label={row.label}>{paper.summary ? <p className="text-sm text-slate-300">{paper.summary}</p> : notWritten}</DetailRow>;
          }
          if (row.special === "status") {
            return (
              <DetailRow key={row.label} label={row.label}>
                <div className="flex flex-col items-start gap-2">
                  <StatusPill kind={paperPill(paper.status)} />
                  <p className="text-sm text-slate-300">{STATUS_TEXT[paper.status]}</p>
                </div>
              </DetailRow>
            );
          }
          const parts = row.from.map((h) => ({ heading: h, body: sectionBody(paper, h) })).filter((p) => p.body);
          return (
            <DetailRow key={row.label} label={row.label}>
              {parts.length === 0
                ? notWritten
                : parts.map((p) => (
                    <div key={p.heading} className="mb-3 last:mb-0">
                      {row.from.length > 1 && <Eyebrow className="mb-1.5">{p.heading}</Eyebrow>}
                      <Markdown text={p.body!} paperLabel={paperLabel} />
                    </div>
                  ))}
            </DetailRow>
          );
        })
      )}
      {extra.map((s) => (
        <DetailRow key={s.heading} label={s.heading}>
          <Markdown text={s.body} paperLabel={paperLabel} />
        </DetailRow>
      ))}

      <footer className="flex flex-wrap items-center gap-2 border-t border-slate-800 px-5 py-4">
        {paper.seeAlso.length > 0 && <span className="text-xs font-semibold text-slate-400">See also</span>}
        {paper.seeAlso
          .map((slug) => bySlug.get(slug))
          .filter((p): p is Paper => p !== undefined)
          .map((p) => (
            <Link key={p.slug} to={researchPath.paper(p.slug)} className="rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[11px] text-slate-300 hover:border-cyan-500/50">
              {paperLabel(p.slug)}
            </Link>
          ))}
        <span className="ml-auto flex gap-2">
          {prev && <Link to={researchPath.paper(prev.slug)} className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:text-white">← Previous paper</Link>}
          {next && <Link to={researchPath.paper(next.slug)} className="rounded-md border border-slate-700 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:text-white">Next paper →</Link>}
        </span>
      </footer>
    </article>
  );
}

// ---- integrated paper ----------------------------------------------------------------------------

/** {{related-work}} and {{references}} in _integrated.md are filled in from the paper pages. */
function IntegratedBody({ forPrint = false }: { forPrint?: boolean }) {
  if (!integrated) return null;
  const refs = [...builtPapers].sort((a, b) => a.authors.localeCompare(b.authors));
  const head = forPrint ? "mt-6 mb-2 text-base font-bold" : "mb-2 text-sm font-semibold text-white";
  return (
    <div className={forPrint ? "space-y-3" : "space-y-7 px-5 py-6"}>
      <h1 className={forPrint ? "text-2xl font-bold" : "max-w-4xl text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl"}>{integrated.title}</h1>
      <p className={forPrint ? "text-xs" : "text-xs text-amber-200"}>Draft. Performance has not been measured yet, so this paper makes no performance claims.</p>
      {integrated.sections.map((s) => (
        <section key={s.heading}>
          <h2 className={head}>{s.heading}</h2>
          {s.body.trim() === "{{related-work}}" ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-xs">
                <thead className={forPrint ? "" : "text-[10px] uppercase tracking-wider text-slate-500"}>
                  <tr><th className="py-1.5 pr-3">Work</th><th className="py-1.5 pr-3">How it shaped TickForge</th><th className="py-1.5">Status</th></tr>
                </thead>
                <tbody>
                  {builtPapers.map((p) => (
                    <tr key={p.slug} className="border-t border-slate-800 align-top text-slate-300">
                      <td className="py-1.5 pr-3 font-semibold">{paperLabel(p.slug)}</td>
                      <td className="py-1.5 pr-3">{p.summary}</td>
                      <td className="py-1.5">{p.status === "partial" ? "partly built" : p.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : s.body.trim() === "{{references}}" ? (
            <ol className={`list-decimal space-y-1.5 pl-5 text-xs leading-relaxed ${forPrint ? "" : "text-slate-300"}`}>
              {refs.map((p) => (
                <li key={p.slug}>
                  {citation(p)} {p.doi && <span className="font-mono">doi:{p.doi}</span>}
                  {!p.citationVerified && " (citation not yet checked)"}
                </li>
              ))}
            </ol>
          ) : (
            <Markdown text={s.body} paperLabel={paperLabel} />
          )}
        </section>
      ))}
    </div>
  );
}

export function IntegratedPaperView() {
  const [printing, setPrinting] = useState(false);
  const printRequested = useRef(false); // print exactly once per click, even if the effect runs twice
  useEffect(() => {
    const after = () => {
      document.documentElement.classList.remove("printing-paper");
      setPrinting(false);
    };
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("afterprint", after);
      document.documentElement.classList.remove("printing-paper");
    };
  }, []);
  useEffect(() => {
    if (!printing || !printRequested.current) return;
    printRequested.current = false;
    document.documentElement.classList.add("printing-paper"); // print CSS: hide the app, show only the paper
    window.print();
  }, [printing]);

  if (!integrated) return <p className="text-sm text-slate-400">The integrated paper file (research/_integrated.md) is missing.</p>;
  return (
    <article className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70">
      <div className="flex justify-end border-b border-slate-800 px-5 py-3">
        <button
          type="button"
          onClick={() => {
            printRequested.current = true;
            setPrinting(true);
          }} className="cursor-pointer rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition hover:border-cyan-400">
          Export as PDF
        </button>
      </div>
      <IntegratedBody />
      {printing &&
        createPortal(
          <div className="print-only">
            <IntegratedBody forPrint />
          </div>,
          document.body,
        )}
    </article>
  );
}

// ---- dashboard link ------------------------------------------------------------------------------

/** Small link for dashboard panels: opens the paper that explains why that part is built the way it is. */
export function WhyChip({ slug }: { slug: string }) {
  const paper = bySlug.get(slug);
  if (!paper) return null;
  return (
    <Link
      to={researchPath.paper(slug)}
      title={`${paper.title} (${paper.year})`}
      className="whitespace-nowrap rounded-md border border-cyan-500/30 bg-cyan-500/5 px-2 py-1 text-[10px] font-bold text-cyan-300 transition hover:border-cyan-400"
    >
      Why built this way?
    </Link>
  );
}
