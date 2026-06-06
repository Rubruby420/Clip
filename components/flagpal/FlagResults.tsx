"use client";

import { useEffect } from "react";
import { X, CheckCircle, AlertTriangle, AlertCircle, ShieldAlert } from "lucide-react";
import { type FlagReport, type FlagViolation, type FlagSeverity } from "@/lib/flagpal";
import { formatDuration } from "@/lib/utils";

export interface ScanResult {
  kind: "project" | "clip";
  id: string;
  title: string;
  report: FlagReport;
}

interface Props {
  results: ScanResult[];
  onClose: () => void;
}

const SEVERITY_CONFIG: Record<FlagSeverity, { label: string; className: string }> = {
  high:   { label: "High",   className: "bg-red-500/20 text-red-300 border-red-700" },
  medium: { label: "Medium", className: "bg-amber-500/20 text-amber-300 border-amber-700" },
  low:    { label: "Low",    className: "bg-yellow-500/20 text-yellow-300 border-yellow-700" },
};

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  "Profanity":        <span className="text-[14px]">🤬</span>,
  "Hate/Harassment":  <span className="text-[14px]">🚫</span>,
  "Violence/Graphic": <span className="text-[14px]">⚠️</span>,
  "Sexual":           <span className="text-[14px]">🔞</span>,
  "Dangerous Acts":   <span className="text-[14px]">💀</span>,
  "Copyright":        <span className="text-[14px]">©️</span>,
  "Misinformation":   <span className="text-[14px]">❌</span>,
  "Other":            <span className="text-[14px]">⚑</span>,
};

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? "bg-red-500" : score >= 40 ? "bg-amber-500" : "bg-green-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-surface-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-bold tabular-nums text-surface-300">{score}/100</span>
    </div>
  );
}

function ViolationRow({ v }: { v: FlagViolation }) {
  const sev = SEVERITY_CONFIG[v.severity] ?? SEVERITY_CONFIG.medium;
  return (
    <div className="bg-surface-800 rounded-lg p-3 border border-surface-600">
      <div className="flex items-start gap-2 mb-1.5">
        <span>{CATEGORY_ICON[v.category] ?? CATEGORY_ICON["Other"]}</span>
        <span className="text-white text-xs font-semibold flex-1">{v.category}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${sev.className}`}>
          {sev.label}
        </span>
        {v.time != null && (
          <span className="text-[10px] text-surface-500 tabular-nums">@{formatDuration(v.time)}</span>
        )}
      </div>
      {v.quote && (
        <blockquote className="text-[11px] text-surface-400 italic border-l-2 border-surface-600 pl-2 mb-1.5 line-clamp-2">
          "{v.quote}"
        </blockquote>
      )}
      <p className="text-[11px] text-surface-300 mb-1">{v.explanation}</p>
      <p className="text-[10px] text-surface-500">Policy: {v.policy}</p>
    </div>
  );
}

function ResultCard({ result }: { result: ScanResult }) {
  const { report } = result;
  const flagged = report.status === "flagged";
  return (
    <div className={`rounded-xl border overflow-hidden ${flagged ? "border-amber-700/50" : "border-surface-600"}`}>
      {/* Card header */}
      <div className={`flex items-center gap-3 px-4 py-3 ${flagged ? "bg-amber-900/20" : "bg-surface-800"}`}>
        {flagged
          ? <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          : <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">{result.title}</p>
          <p className={`text-xs mt-0.5 ${flagged ? "text-amber-300" : "text-green-400"}`}>{report.summary}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
          flagged ? "bg-amber-600 text-white" : "bg-green-700 text-white"
        }`}>
          {flagged ? "FLAGGED" : "CLEAN"}
        </span>
      </div>

      {/* Risk bar */}
      <div className="px-4 py-2 bg-surface-900/50 border-t border-surface-700">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-3 h-3 text-surface-500" />
          <span className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">Risk Score</span>
        </div>
        <ScoreBar score={report.riskScore} />
      </div>

      {/* Violations */}
      {report.violations.length > 0 && (
        <div className="px-4 py-3 bg-surface-900/30 border-t border-surface-700 flex flex-col gap-2">
          {report.violations.map((v, i) => (
            <ViolationRow key={i} v={v} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FlagResults({ results, onClose }: Props) {
  const flaggedCount = results.filter((r) => r.report.status === "flagged").length;

  // Prevent the page behind from scrolling while the modal is open
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    // Backdrop IS the scroll container — panel renders at natural height,
    // backdrop scrolls when panel is taller than the screen.
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="w-full max-w-2xl bg-surface-900 rounded-2xl border border-surface-600 shadow-2xl my-4"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-700">
            <AlertCircle className="w-5 h-5 text-brand-400" />
            <div className="flex-1">
              <h2 className="text-white font-bold">FlagPal Results</h2>
              <p className="text-xs text-surface-500 mt-0.5">
                {results.length} item{results.length !== 1 ? "s" : ""} scanned
                {flaggedCount > 0 ? ` — ${flaggedCount} flagged` : " — all clean"}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-surface-400 hover:text-white hover:bg-surface-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Results — no height cap, backdrop handles the scroll */}
          <div className="p-5 flex flex-col gap-4">
            {results.map((r) => (
              <ResultCard key={`${r.kind}-${r.id}`} result={r} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
