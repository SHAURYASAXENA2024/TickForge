// "how'z that!" — the standalone research page at /howz-that (see router.tsx for the routes).
// Content lives in ./howzthat/content.ts (sections) and ./research/*.md (papers); this file is presentation only.
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ABSTRACT,
  ACKNOWLEDGMENTS,
  BEHAVIOUR_PROBLEMS,
  CAPABILITIES,
  CENTRAL_PROBLEM,
  COMPONENTS,
  DIFFERENTIATORS,
  ENGINE_FLOW,
  EVIDENCE,
  EXPERIMENTS,
  INTRO_POINTS,
  LIMITATIONS,
  MARKET_FLOW,
  OBJECTIVE,
  PDF_REFERENCES,
  RESEARCH_AREAS,
  RESEARCH_GAP,
  RESULTS,
  ROADMAP,
  SECTIONS,
  STATUS_LABEL,
  STORAGE_FLOW,
  SYSTEM_PROBLEMS,
  THEMES,
  type Differentiator,
  type Experiment,
  type FlowNode,
  type Problem,
  type Status,
} from "./howzthat/content";
import { Eyebrow, StatusPill, linkClass } from "./howzthat/ui";
import { IntegratedPaperView, PaperDetail, PaperLibrary, builtPapers, bySlug, paperLabel } from "./HowzThat";
import { citation } from "./research";
import { Link, parseResearchPath, researchPath } from "./router";

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}

// ---- page shell ------------------------------------------------------------------------------------

function TopBar({ trail }: { trail: { label: string; to?: string }[] }) {
  return (
    <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 lg:px-8">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
        >
          <span aria-hidden="true">←</span> Back to TickForge
        </Link>
        <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
          <ol className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {trail.map((item, i) => (
              <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-2">
                {i > 0 && <span aria-hidden="true" className="text-slate-600">/</span>}
                {item.to ? (
                  <Link to={item.to} className="font-semibold text-slate-400 hover:text-white">{item.label}</Link>
                ) : (
                  <span aria-current="page" className="truncate text-slate-200">{item.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex items-center gap-1 text-xs">
          <Link to={researchPath.section("paper-library")} className="rounded-md px-2.5 py-1.5 font-semibold text-slate-400 hover:text-white">Paper library</Link>
          <Link to={researchPath.integrated} className="rounded-md px-2.5 py-1.5 font-semibold text-slate-400 hover:text-white">Integrated paper</Link>
        </div>
      </div>
    </header>
  );
}

/** Which section heading is in the reading zone, for the table-of-contents highlight. */
function useActiveSection(ids: string[]) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [ids]);
  return active;
}

const SECTION_IDS = SECTIONS.map((s) => s.id);

function TocList({ active, onPick }: { active: string; onPick?: () => void }) {
  return (
    <ol className="space-y-0.5">
      {SECTIONS.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            aria-current={active === s.id ? "location" : undefined}
            onClick={(event) => {
              event.preventDefault();
              window.history.pushState(null, "", `#${s.id}`);
              onPick?.(); // close the mobile menu first, so the layout doesn't shift under the scroll
              window.requestAnimationFrame(() => scrollToId(s.id));
            }}
            className={`flex items-baseline gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition ${
              active === s.id ? "bg-slate-800 font-semibold text-white" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
            }`}
          >
            <span className={`font-mono text-[10px] ${active === s.id ? "text-cyan-300" : "text-slate-600"}`}>{s.number}</span>
            {s.short}
          </a>
        </li>
      ))}
    </ol>
  );
}

function Section({ id, lead, children }: { id: string; lead?: ReactNode; children: ReactNode }) {
  const meta = SECTIONS.find((s) => s.id === id)!;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 border-t border-slate-800/80 pt-10 first:border-t-0 first:pt-0">
      <div className="font-mono text-xs text-cyan-300">Section {meta.number}</div>
      <h2 id={`${id}-title`} className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-[1.7rem]">{meta.title}</h2>
      {lead && <div className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">{lead}</div>}
      <div className="mt-6 space-y-6">{children}</div>
    </section>
  );
}

function Card({ children, className = "", dashed = false }: { children: ReactNode; className?: string; dashed?: boolean }) {
  return <div className={`rounded-xl border ${dashed ? "border-dashed border-slate-700 bg-transparent" : "border-slate-800 bg-slate-900/60"} p-4 ${className}`}>{children}</div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm leading-relaxed text-slate-300">{children}</dd>
    </div>
  );
}

function Files({ files }: { files?: string[] }) {
  if (!files || files.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {files.map((f) => (
        <li key={f}>
          <code className="block rounded border border-slate-800 bg-slate-950 px-1.5 py-0.5 font-mono text-[11px] text-slate-300 [overflow-wrap:anywhere]">{f}</code>
        </li>
      ))}
    </ul>
  );
}

function PaperLinks({ slugs }: { slugs?: string[] }) {
  const known = (slugs ?? []).filter((s) => bySlug.has(s));
  if (known.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {known.map((s) => (
        <Link key={s} to={researchPath.paper(s)} className={`${linkClass} text-xs`}>{paperLabel(s)}</Link>
      ))}
    </span>
  );
}

const pillFor = (s: Status) => <StatusPill kind={s} label={STATUS_LABEL[s]} />;

// ---- 01 ------------------------------------------------------------------------------------------------

function Connector({ label, dir = "right" }: { label: string; dir?: "right" | "left" }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1 text-[10px] text-slate-500 lg:flex-col lg:gap-1 lg:py-0">
      <span aria-hidden="true" className="text-slate-500 lg:hidden">↓</span>
      <span className="text-center font-mono leading-tight">{label}</span>
      <span aria-hidden="true" className="hidden text-base text-slate-500 lg:block">{dir === "right" ? "⟶" : "⟵"}</span>
    </div>
  );
}

function MapBox({ title, sub, items, status = "implemented", className = "" }: { title: string; sub: string; items?: string[]; status?: Status; className?: string }) {
  return (
    <div className={`rounded-xl border p-3 ${status === "planned" ? "border-dashed border-slate-700" : "border-slate-700 bg-slate-900"} ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="text-[11px] text-slate-400">{sub}</div>
        </div>
        {status !== "implemented" && pillFor(status)}
      </div>
      {items && (
        <ol className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-slate-300">
          {items.map((item, i) => (
            <li key={item} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true" className="text-slate-600">→</span>}
              <span className="rounded border border-slate-700 bg-slate-950/60 px-1.5 py-0.5">{item}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** High-level system map: processes and how they talk. Planned parts are dashed. */
function SystemMap() {
  return (
    <figure className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>System map · as built today</Eyebrow>
        <span className="text-[11px] text-slate-500">Dashed = designed in the research document, not built</span>
      </figcaption>
      <div className="grid gap-2 lg:grid-cols-[1.6fr_6.5rem_1fr_6.5rem_1fr] [&>*]:min-w-0 lg:items-center">
        <MapBox
          title="Matching engine · C++17"
          sub="one process, telemetry_engine"
          items={["4 producers", "MPSC queue", "matching thread", "order book", "telemetry"]}
          className="lg:col-start-1 lg:row-start-1"
        />
        <div className="lg:col-start-2 lg:row-start-1"><Connector label="stdin commands · stdout JSON" /></div>
        <MapBox title="Telemetry bridge · Python" sub="127.0.0.1 only · validates every command" className="lg:col-start-3 lg:row-start-1" />
        <div className="lg:col-start-4 lg:row-start-1"><Connector label="WebSocket :9001" /></div>
        <MapBox title="Browser · React" sub="dashboard and this page" items={["engine panels", "market data", "Journey"]} className="lg:col-start-5 lg:row-span-2 lg:row-start-1 lg:self-stretch" />
        <MapBox title="Yahoo Finance" sub="external price data" className="lg:col-start-1 lg:row-start-2" />
        <div className="lg:col-start-2 lg:row-start-2"><Connector label="yfinance" /></div>
        <MapBox title="Market-data API · FastAPI" sub="whitelist · cache · Journey analytics" className="lg:col-start-3 lg:row-start-2" />
        <div className="lg:col-start-4 lg:row-start-2"><Connector label="HTTP :8000" /></div>
        <MapBox
          title="Durable storage"
          sub="would hang off the matching thread's trades"
          items={["WAL", "MemTable", "SSTables", "replay"]}
          status="planned"
          className="lg:col-start-1 lg:row-start-3"
        />
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
        The engine and the market-data API are independent: the engine trades one synthetic instrument (around $150), while the API serves real S&amp;P 500 prices. They are never mixed on one chart.
      </p>
    </figure>
  );
}

function BigPicture() {
  return (
    <Section id="big-picture" lead="What TickForge is, what it is trying to achieve, and the parts it is made of.">
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr] [&>*]:min-w-0">
        <Card>
          <Eyebrow>Abstract</Eyebrow>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{ABSTRACT}</p>
        </Card>
        <Card className="border-cyan-500/25 bg-cyan-500/[0.04]">
          <Eyebrow className="text-cyan-300">Engineering objective</Eyebrow>
          <p className="mt-2 text-sm leading-relaxed text-slate-200">{OBJECTIVE}</p>
        </Card>
      </div>
      <SystemMap />
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Technical themes</h3>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {THEMES.map((t) => (
            <li key={t.title}>
              <Card className="h-full">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-semibold text-white">{t.title}</div>
                  {pillFor(t.status)}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">{t.text}</p>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

// ---- 02 ------------------------------------------------------------------------------------------------

function ProblemList({ title, letter, items }: { title: string; letter: string; items: Problem[] }) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
        <span className="grid size-6 place-items-center rounded-md border border-slate-700 font-mono text-[11px] text-cyan-300">{letter}</span>
        {title}
      </h3>
      <ul className="space-y-2.5">
        {items.map((p) => (
          <li key={p.title}>
            <Card>
              <div className="text-sm font-semibold text-white">{p.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{p.text}</p>
              <div className="mt-2.5 flex flex-col gap-1.5 border-t border-slate-800 pt-2.5 sm:flex-row sm:items-start sm:gap-3">
                <div className="shrink-0">{pillFor(p.status)}</div>
                <p className="text-xs leading-relaxed text-slate-300"><span className="font-semibold text-slate-200">TickForge today: </span>{p.today}</p>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProblemStatement() {
  return (
    <Section
      id="problem-statement"
      lead="The research document names two groups of problems. Each card says where TickForge stands today, because listing a problem is not the same as having solved it."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <ProblemList title="Systems problems" letter="A" items={SYSTEM_PROBLEMS} />
        <ProblemList title="User-behaviour problems" letter="B" items={BEHAVIOUR_PROBLEMS} />
      </div>
      <blockquote className="rounded-xl border-l-2 border-cyan-400 bg-slate-900/60 px-5 py-4">
        <Eyebrow className="text-cyan-300">Problem statement in one line</Eyebrow>
        <p className="mt-2 text-base leading-relaxed text-white">{CENTRAL_PROBLEM}</p>
      </blockquote>
    </Section>
  );
}

// ---- 03 ------------------------------------------------------------------------------------------------

function ExistingWork() {
  return (
    <Section
      id="existing-work"
      lead="Organised by topic. For each one: the problem studied, what the research found, why it matters here, what it decided in our design, and what is still different or missing."
    >
      <div className="space-y-2.5">
        {RESEARCH_AREAS.map((a) => (
          <details key={a.topic} className="group rounded-xl border border-slate-800 bg-slate-900/60 open:bg-slate-900/80">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="text-slate-500 transition group-open:rotate-90 motion-reduce:transition-none">▸</span>
              <span className="text-sm font-semibold text-white">{a.topic}</span>
              {pillFor(a.status)}
              <span className="ml-auto text-xs text-slate-500">{a.papers.map((s) => paperLabel(s)).filter(Boolean).join(" · ")}</span>
            </summary>
            <div className="border-t border-slate-800 px-4 py-4">
              <dl className="grid gap-4 md:grid-cols-2">
                <Field label="Problem studied">{a.problem}</Field>
                <Field label="What the research found">{a.finding}</Field>
                <Field label="Relevance to TickForge">{a.relevance}</Field>
                <Field label="Design decision it informed">{a.decision}</Field>
                <div className="md:col-span-2">
                  <Field label="Still different, unimplemented or unverified">{a.gap}</Field>
                </div>
              </dl>
              <div className="mt-4 flex flex-col gap-2 text-xs text-slate-400 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                <PaperLinks slugs={a.papers} />
                {a.pdfOnly && a.pdfOnly.length > 0 && (
                  <span>Also cited in the research document (no page yet): {a.pdfOnly.join("; ")}.</span>
                )}
              </div>
            </div>
          </details>
        ))}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Comparison</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[46rem] text-left text-xs">
            <caption className="sr-only">Prior work compared with what TickForge implements</caption>
            <thead className="bg-slate-900 text-[11px] text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-semibold">Research / prior work</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Key idea</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Relevance to TickForge</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Our implementation or planned extension</th>
              </tr>
            </thead>
            <tbody>
              {RESEARCH_AREAS.map((a) => (
                <tr key={a.topic} className="border-t border-slate-800 align-top text-slate-300">
                  <th scope="row" className="px-3 py-2.5 text-left font-normal">
                    <div className="font-semibold text-white">{a.topic}</div>
                    <div className="mt-1"><PaperLinks slugs={a.papers} /></div>
                  </th>
                  <td className="px-3 py-2.5">{a.finding}</td>
                  <td className="px-3 py-2.5">{a.relevance}</td>
                  <td className="px-3 py-2.5">
                    <div className="mb-1.5">{pillFor(a.status)}</div>
                    {a.decision}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Card className="border-cyan-500/25">
        <h3 className="text-sm font-semibold text-white">The research gap, stated honestly</h3>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-slate-300">
          {RESEARCH_GAP.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </div>
      </Card>
    </Section>
  );
}

// ---- 04 ------------------------------------------------------------------------------------------------

function FlowLane({ title, nodes, planned = false }: { title: string; nodes: FlowNode[]; planned?: boolean }) {
  return (
    <div>
      <Eyebrow className="mb-2">{title}</Eyebrow>
      <ol className="flex flex-col gap-1 lg:flex-row lg:flex-wrap lg:items-stretch" aria-label={title}>
        {nodes.map((n, i) => (
          <li key={`${n.label}-${i}`} className="flex flex-col items-stretch gap-1 lg:flex-row lg:items-center">
            {i > 0 && <span aria-hidden="true" className="text-center text-slate-600 lg:px-0.5">{/* arrow */}<span className="lg:hidden">↓</span><span className="hidden lg:inline">→</span></span>}
            <a
              href={n.component ? `#component-${n.component}` : undefined}
              onClick={(event) => {
                if (!n.component) return;
                event.preventDefault();
                scrollToId(`component-${n.component}`);
              }}
              className={`block rounded-lg border px-2.5 py-1.5 transition hover:border-cyan-500/50 ${
                n.status === "planned" || planned ? "border-dashed border-slate-700 text-slate-400" : "border-slate-700 bg-slate-900 text-slate-200"
              }`}
            >
              <span className="block text-xs font-semibold">{n.label}</span>
              <span className="block text-[10px] text-slate-500">{n.detail}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

function HowItWorks() {
  return (
    <Section
      id="how-tickforge-works"
      lead="From an order being created to a number on screen. Each box links to its component below; dashed boxes are designed but not built."
    >
      <figure className="space-y-5 rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
        <figcaption className="sr-only">Data flow through TickForge: the engine path, the market-data path, and the planned storage path.</figcaption>
        <FlowLane title="Engine path · implemented" nodes={ENGINE_FLOW} />
        <FlowLane title="Market-data path · implemented" nodes={MARKET_FLOW} />
        <FlowLane title="Storage path · planned, not built" nodes={STORAGE_FLOW} />
      </figure>

      <ul className="grid gap-3 md:grid-cols-2">
        {COMPONENTS.map((c) => (
          <li key={c.id} id={`component-${c.id}`} className="scroll-mt-20">
            <Card className="h-full" dashed={c.status === "planned"}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-white">{c.name}</h3>
                {pillFor(c.status)}
              </div>
              <dl className="mt-3 space-y-2.5">
                <Field label="Responsibility">{c.responsibility}</Field>
                {c.problem !== "—" && <Field label="Problem it addresses">{c.problem}</Field>}
                {c.talksTo !== "—" && <Field label="Talks to">{c.talksTo}</Field>}
              </dl>
              {c.files.length > 0 && (
                <div className="mt-3">
                  <Files files={c.files} />
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---- 05 ------------------------------------------------------------------------------------------------

function DifferentiatorItem({ d }: { d: Differentiator }) {
  return (
    <details className="group rounded-xl border border-slate-800 bg-slate-900/60 open:bg-slate-900/80">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-slate-500 transition group-open:rotate-90 motion-reduce:transition-none">▸</span>
        <span className="min-w-0 flex-1 text-sm font-semibold text-white">{d.title}</span>
        {pillFor(d.status)}
      </summary>
      <div className="border-t border-slate-800 px-4 py-4">
        <dl className="grid gap-4 md:grid-cols-2">
          <Field label="1 · Problem">{d.problem}</Field>
          <Field label="2 · Existing research">{d.research}</Field>
          <Field label="3 · Our approach">{d.approach}</Field>
          <Field label="4 · What we actually built">{d.implementation}</Field>
          <Field label="5 · Difference from prior work">{d.difference}</Field>
          <Field label="6 · Verification">{d.verification}</Field>
          <div className="md:col-span-2">
            <Field label="7 · Limitations">{d.limitations}</Field>
          </div>
        </dl>
        {(d.papers || d.files) && (
          <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
            <PaperLinks slugs={d.papers} />
            <Files files={d.files} />
          </div>
        )}
      </div>
    </details>
  );
}

function Differentiators() {
  const all = DIFFERENTIATORS.flatMap((g) => g.items);
  const count = (s: Status) => all.filter((d) => d.status === s).length;
  return (
    <Section
      id="differentiators"
      lead="The research document proposes these differentiators. Each was checked against the code: most are still plans, and they are labelled that way. Open any item for the seven-part breakdown."
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>{all.length} differentiators:</span>
        <StatusPill kind="implemented" label={`${count("implemented")} implemented`} />
        <StatusPill kind="partial" label={`${count("partial")} partially implemented`} />
        <StatusPill kind="planned" label={`${count("planned")} planned`} />
      </div>
      {DIFFERENTIATORS.map((g) => (
        <div key={g.id}>
          <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-slate-200">
            <span className="grid size-6 place-items-center rounded-md border border-slate-700 font-mono text-[11px] text-cyan-300">{g.letter}</span>
            {g.title}
          </h3>
          <div className="space-y-2">
            {g.items.map((d) => (
              <DifferentiatorItem key={d.id} d={d} />
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

// ---- 06 ------------------------------------------------------------------------------------------------

function Capabilities() {
  const groups: { status: Status; title: string }[] = [
    { status: "implemented", title: "Available now" },
    { status: "partial", title: "Partially implemented" },
    { status: "planned", title: "Planned" },
  ];
  return (
    <Section id="capabilities" lead="What a person can actually do with TickForge, and why it matters. Planned items are listed separately.">
      <div className="grid gap-5 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.status}>
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-200">
              {g.title}
              <StatusPill kind={g.status} label={String(CAPABILITIES.filter((c) => c.status === g.status).length)} />
            </h3>
            <ul className="space-y-2">
              {CAPABILITIES.filter((c) => c.status === g.status).map((c) => (
                <li key={c.title}>
                  <Card dashed={g.status === "planned"}>
                    <div className="text-sm font-semibold text-white">{c.title}</div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-300">{c.text}</p>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{c.why}</p>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ---- 07 ------------------------------------------------------------------------------------------------

const EXP_STATE: Record<Experiment["status"], { label: string; kind: "unverified" | "planned" }> = {
  "not-measured": { label: "Not yet measured", kind: "unverified" },
  blocked: { label: "Blocked: prerequisite not built", kind: "planned" },
  optional: { label: "Optional · evaluation planned", kind: "planned" },
};

const fmt = (v: number | null, unit: string) => (v === null ? null : `${v.toLocaleString("en-US")} ${unit}`);

function Evaluation() {
  return (
    <Section
      id="evaluation"
      lead="How TickForge's claims should be tested, following the evaluation plan in the research document. No performance experiment has been run yet, so every result cell says so."
    >
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Evidence that exists today · correctness, not performance</h3>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {EVIDENCE.map((e) => (
            <li key={e.title}>
              <Card className="h-full">
                <div className="text-sm font-semibold text-white">{e.title}</div>
                <div className="mt-1 font-mono text-xs text-emerald-300">{e.result}</div>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{e.how}</p>
              </Card>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-slate-500">Engine checks re-run on Linux on 16 Oct 2026. The engine has not been built or tested on Windows or macOS.</p>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Results</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full min-w-[36rem] text-left text-xs">
            <caption className="sr-only">Benchmark results; cells are empty until measured</caption>
            <thead className="bg-slate-900 text-[11px] text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-semibold">Metric</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Baseline (mutex)</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">TickForge (lock-free)</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Experiment</th>
              </tr>
            </thead>
            <tbody>
              {RESULTS.map((r) => (
                <tr key={r.metric} className="border-t border-slate-800 text-slate-300">
                  <th scope="row" className="px-3 py-2.5 text-left font-semibold text-white">{r.metric}</th>
                  {[r.baseline, r.tickforge].map((v, i) => (
                    <td key={i} className="px-3 py-2.5">{fmt(v, r.unit) ?? <span className="italic text-slate-500">Not yet measured</span>}</td>
                  ))}
                  <td className="px-3 py-2.5">
                    <a href={`#exp-${r.experiment}`} onClick={(e) => { e.preventDefault(); scrollToId(`exp-${r.experiment}`); }} className={linkClass}>
                      {EXPERIMENTS.find((x) => x.id === r.experiment)?.title}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Experiment plan</h3>
        <div className="space-y-2">
          {EXPERIMENTS.map((x) => (
            <details key={x.id} id={`exp-${x.id}`} className="group scroll-mt-20 rounded-xl border border-slate-800 bg-slate-900/60 open:bg-slate-900/80">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="text-slate-500 transition group-open:rotate-90 motion-reduce:transition-none">▸</span>
                <span className="min-w-0 flex-1 text-sm font-semibold text-white">{x.title}</span>
                <StatusPill kind={EXP_STATE[x.status].kind} label={EXP_STATE[x.status].label} />
              </summary>
              <div className="border-t border-slate-800 px-4 py-4">
                <dl className="grid gap-4 md:grid-cols-2">
                  <Field label="Hypothesis">{x.hypothesis}</Field>
                  <Field label="Baseline">{x.baseline}</Field>
                  <Field label="Independent variable">{x.variable}</Field>
                  <Field label="Metric">{x.metric}</Field>
                  <Field label="Procedure">{x.procedure}</Field>
                  <Field label="How to read the result">{x.interpretation}</Field>
                  <div className="md:col-span-2">
                    <Field label="What is missing before it can run">{x.needs}</Field>
                  </div>
                </dl>
              </div>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ---- 09 ------------------------------------------------------------------------------------------------

const STAGE: Record<"next" | "planned" | "later", { label: string; cls: string }> = {
  next: { label: "Next", cls: "border-cyan-500/40 text-cyan-200" },
  planned: { label: "Planned", cls: "border-slate-600 text-slate-300" },
  later: { label: "Later · advanced", cls: "border-slate-700 text-slate-400" },
};

function Limitations() {
  return (
    <Section id="limitations" lead="Where TickForge stops today, and what would come next, in order. Nothing in this section is in progress in the code right now; the benchmark harness is the next step.">
      <Card>
        <h3 className="text-sm font-semibold text-white">Current limitations</h3>
        <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-sm text-slate-300 md:grid-cols-2">
          {LIMITATIONS.map((l) => (
            <li key={l} className="flex gap-2">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-slate-500" />
              {l}
            </li>
          ))}
        </ul>
      </Card>
      <ol className="space-y-2.5">
        {ROADMAP.map((r, i) => (
          <li key={r.title}>
            <Card>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-sm font-semibold text-white">{r.title}</h3>
                <span className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STAGE[r.stage].cls}`}>{STAGE[r.stage].label}</span>
              </div>
              <dl className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Problem it addresses">{r.problem}</Field>
                <Field label="Why it matters">{r.why}</Field>
                <Field label="Needs first">{r.needs}</Field>
                <Field label="Done when">{r.done}</Field>
              </dl>
            </Card>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ---- 10 ------------------------------------------------------------------------------------------------

function References() {
  const groups: { kind: (typeof PDF_REFERENCES)[number]["kind"][]; title: string }[] = [
    { kind: ["paper"], title: "Academic papers" },
    { kind: ["spec", "doc"], title: "Technical specifications and engineering documents" },
    { kind: ["book"], title: "Books" },
  ];
  return (
    <Section id="references" lead="Everything cited on this page. Citations checked against the publisher or a bibliography page are marked; the rest are copied from the research document and still need checking.">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-200">Papers with a page in the library</h3>
        <ol className="space-y-2 text-sm leading-relaxed text-slate-300">
          {[...builtPapers].sort((a, b) => a.authors.localeCompare(b.authors)).map((p) => (
            <li key={p.slug} className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 sm:flex-row sm:items-baseline sm:gap-3">
              <span className="min-w-0 flex-1">
                {citation(p)}{" "}
                {p.doi && <a href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer" className={`${linkClass} font-mono text-xs`}>doi:{p.doi}</a>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {p.citationVerified ? <span className="text-[11px] text-emerald-300">Citation checked</span> : <span className="text-[11px] text-amber-200">Not yet checked</span>}
                <Link to={researchPath.paper(p.slug)} className={`${linkClass} text-xs`}>Page</Link>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Reading list and other works cited in the research document</h3>
        <p className="mb-3 mt-1 text-xs text-slate-500">As written in the research document; not yet checked against the publishers. Links are only given where the document provides one.</p>
        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <Eyebrow className="mb-2">Reading-list pages</Eyebrow>
            <ul className="space-y-1.5 text-sm text-slate-300">
              {[...bySlug.values()].filter((p) => p.status === "planned").map((p) => (
                <li key={p.slug}>
                  {citation(p)} <Link to={researchPath.paper(p.slug)} className={`${linkClass} text-xs`}>Page</Link>
                </li>
              ))}
            </ul>
          </div>
          {groups.map((g) => (
            <div key={g.title}>
              <Eyebrow className="mb-2">{g.title}</Eyebrow>
              <ul className="space-y-1.5 text-sm text-slate-300">
                {PDF_REFERENCES.filter((r) => g.kind.includes(r.kind)).map((r) => (
                  <li key={r.text}>
                    {r.text}{" "}
                    {r.url && <a href={r.url} target="_blank" rel="noreferrer" className={`${linkClass} text-xs`}>link</a>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <Card>
        <h3 className="text-sm font-semibold text-white">Acknowledgments</h3>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
          {ACKNOWLEDGMENTS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </Card>
    </Section>
  );
}

// ---- the overview page ---------------------------------------------------------------------------

function Overview() {
  const active = useActiveSection(SECTION_IDS);
  const mobileToc = useRef<HTMLDetailsElement>(null);

  // Deep links such as /howz-that#evaluation: scroll once the sections exist.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) window.requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, []);

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-20 pt-8 lg:px-8">
      <div className="max-w-3xl">
        <Eyebrow className="text-cyan-300">TickForge · research and engineering notes</Eyebrow>
        <h1 className="mt-2 text-4xl font-black tracking-tight text-white sm:text-5xl">how&apos;z that!</h1>
        <p className="mt-2 text-lg text-slate-300">Research, engineering decisions, and the ideas behind TickForge.</p>
        <p className="mt-4 text-sm leading-relaxed text-slate-400">
          This page documents {INTRO_POINTS.slice(0, -1).join(", ")}, and {INTRO_POINTS[INTRO_POINTS.length - 1]}. It follows the team&apos;s research document and was checked against the code; anything not built is labelled as such, and no performance number appears unless it was measured.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>Status labels:</span>
          {(["implemented", "partial", "planned", "unverified"] as Status[]).map((s) => (
            <StatusPill key={s} kind={s} label={STATUS_LABEL[s]} />
          ))}
        </div>
      </div>

      <details ref={mobileToc} className="mt-6 rounded-xl border border-slate-800 bg-slate-900/70 lg:hidden">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-200">On this page</summary>
        <div className="border-t border-slate-800 p-2">
          <TocList active={active} onPick={() => mobileToc.current?.removeAttribute("open")} />
        </div>
      </details>

      <div className="mt-8 grid gap-10 lg:grid-cols-[13rem_1fr]">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-20">
            <Eyebrow className="mb-2 px-2.5">On this page</Eyebrow>
            <TocList active={active} />
          </div>
        </nav>
        <div className="min-w-0 space-y-12">
          <BigPicture />
          <ProblemStatement />
          <ExistingWork />
          <HowItWorks />
          <Differentiators />
          <Capabilities />
          <Evaluation />
          <Section id="paper-library" lead="The papers behind TickForge, one page each, with what we took, what we changed, where it lives in the code and how it was checked. Search or filter, then open a paper.">
            <PaperLibrary />
          </Section>
          <Limitations />
          <References />
        </div>
      </div>
    </div>
  );
}

// ---- route switch --------------------------------------------------------------------------------

export default function HowzThatPage({ path }: { path: string }) {
  const route = parseResearchPath(path);
  const paper = route.view === "paper" ? bySlug.get(route.slug) : undefined;
  const home = { label: "how'z that!", to: researchPath.home };
  const root = { label: "TickForge", to: "/" };

  let title = "how'z that! · TickForge";
  let trail: { label: string; to?: string }[] = [root, { label: "how'z that!" }];
  let body: ReactNode;

  if (route.view === "home") {
    body = <Overview />;
  } else if (route.view === "integrated") {
    title = "Integrated paper · how'z that! · TickForge";
    trail = [root, home, { label: "Integrated paper" }];
    body = <IntegratedPaperView />;
  } else if (paper) {
    title = `${paper.title} · how'z that! · TickForge`;
    trail = [root, home, { label: "Papers", to: researchPath.section("paper-library") }, { label: paperLabel(paper.slug) ?? paper.title }];
    body = <PaperDetail paper={paper} />;
  } else {
    title = "Not found · how'z that! · TickForge";
    trail = [root, home, { label: "Not found" }];
    body = (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-5 py-10 text-center">
        <h1 className="text-xl font-bold text-white">That research page does not exist</h1>
        <p className="mt-2 text-sm text-slate-400">{route.view === "paper" ? `There is no paper called “${route.slug}”.` : "The address does not match a page."}</p>
        <Link to={researchPath.section("paper-library")} className={`${linkClass} mt-4 inline-block text-sm`}>Go to the paper library</Link>
      </div>
    );
  }

  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <div className="min-h-screen">
      <TopBar trail={trail} />
      <main id="main">
        {route.view === "home" ? body : <div className="mx-auto max-w-[1100px] px-4 pb-20 pt-8 lg:px-8">{body}</div>}
      </main>
    </div>
  );
}
