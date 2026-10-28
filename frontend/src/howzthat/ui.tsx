// Small presentational pieces shared by the research page and the paper library.
import { Fragment, type ReactNode } from "react";
import { parseBlocks, parseInline } from "../research";
import { Link, researchPath } from "../router";

export type PillKind = "implemented" | "partial" | "planned" | "unverified" | "rejected" | "reading";

const PILL: Record<PillKind, { label: string; cls: string; dot: string }> = {
  implemented: { label: "Implemented", cls: "border-emerald-500/25 text-emerald-300", dot: "bg-emerald-400" },
  partial: { label: "Partially implemented", cls: "border-amber-500/25 text-amber-200", dot: "bg-amber-400" },
  planned: { label: "Planned", cls: "border-blue-500/25 text-blue-300", dot: "bg-blue-400" },
  unverified: { label: "Not verified", cls: "border-slate-600 text-slate-300", dot: "bg-slate-400" },
  rejected: { label: "Rejected", cls: "border-rose-500/25 text-rose-300", dot: "bg-rose-400" },
  reading: { label: "Reading list", cls: "border-blue-500/25 text-blue-300", dot: "bg-blue-400" },
};

/** One status system for the whole page: a dot + a word, never colour alone. */
export function StatusPill({ kind, label }: { kind: PillKind; label?: string }) {
  const p = PILL[kind];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border bg-slate-950/40 px-2 py-0.5 text-[10px] font-semibold ${p.cls}`}>
      <span aria-hidden="true" className={`size-1.5 rounded-full ${p.dot}`} />
      {label ?? p.label}
    </span>
  );
}

export const linkClass = "text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 hover:decoration-cyan-300";

/** Inline markdown: `code`, **bold**, *italic*, [text](https://…) and [[paper-slug]] links. */
export function Rich({ text, paperLabel }: { text: string; paperLabel?: (slug: string) => string | null }) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        if (part.type === "code") return <code key={i} className="rounded bg-slate-950 px-1 py-0.5 font-mono text-[0.85em] text-cyan-200 [overflow-wrap:anywhere]">{part.text}</code>;
        if (part.type === "bold") return <strong key={i} className="font-semibold text-white">{part.text}</strong>;
        if (part.type === "italic") return <em key={i}>{part.text}</em>;
        if (part.type === "link") return <a key={i} href={part.href} target="_blank" rel="noreferrer" className={linkClass}>{part.text}</a>;
        if (part.type === "paper") {
          const label = paperLabel?.(part.slug);
          return label ? <Link key={i} to={researchPath.paper(part.slug)} className={linkClass}>{label}</Link> : <span key={i}>{part.slug}</span>;
        }
        return <Fragment key={i}>{part.text}</Fragment>;
      })}
    </>
  );
}

export function Markdown({ text, paperLabel, className = "" }: { text: string; paperLabel?: (slug: string) => string | null; className?: string }) {
  return (
    <div className={`space-y-2.5 text-sm leading-relaxed text-slate-300 ${className}`}>
      {parseBlocks(text).map((block, i) =>
        block.type === "p" ? (
          <p key={i}><Rich text={block.text} paperLabel={paperLabel} /></p>
        ) : (
          <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-slate-600">
            {block.items.map((item, j) => (
              <li key={j}><Rich text={item} paperLabel={paperLabel} /></li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

/** Small uppercase label used above blocks of content. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 ${className}`}>{children}</div>;
}
