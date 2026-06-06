"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  X, CheckCircle, AlertTriangle, AlertCircle, ShieldAlert,
  Wrench, Copy, Check, Loader2, Scissors, Radio, TrendingUp,
} from "lucide-react";
import {
  type FlagReport, type FlagViolation, type FlagSeverity,
  type FlagOutcome, type SensitiveTopic, type FlagPlatform,
} from "@/lib/flagpal";
import { formatDuration } from "@/lib/utils";

export interface ScanResult {
  kind: "project" | "clip";
  id: string;
  title: string;
  report: FlagReport;
}

interface Props {
  results: ScanResult[];
  platform: FlagPlatform;
  onClose: () => void;
}

// ── Outcome badge ──────────────────────────────────────────────────────────
const OUTCOME_CONFIG: Record<FlagOutcome, { label: string; className: string }> = {
  "strike":        { label: "Strike",       className: "bg-red-600 text-white" },
  "demonetization":{ label: "Demonetized",  className: "bg-orange-500 text-white" },
  "age-gate":      { label: "Age-Gated",    className: "bg-purple-600 text-white" },
  "limited-ads":   { label: "Limited Ads",  className: "bg-yellow-500 text-black" },
};

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button
      onClick={copy}
      className="p-1 rounded text-surface-500 hover:text-white hover:bg-surface-700 transition-colors"
      title="Copy"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function RewriteSection({ v, platform }: { v: FlagViolation; platform: FlagPlatform }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rewrites, setRewrites] = useState<string[]>([]);

  async function fetchRewrites() {
    if (rewrites.length > 0) { setOpen(true); return; }
    setOpen(true);
    setLoading(true);
    try {
      const res = await fetch("/api/flagpal/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quote: v.quote, context: v.explanation, category: v.category, platform }),
      });
      const data = await res.json();
      setRewrites(data.rewrites ?? []);
    } catch { /* silent */ }
    setLoading(false);
  }

  return (
    <div className="mt-1.5">
      <button
        onClick={open ? () => setOpen(false) : fetchRewrites}
        className="flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300 transition-colors"
      >
        <Radio className="w-3 h-3" />
        {open ? "Hide rewrites" : "Generate compliant rewrites"}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {loading ? (
            <div className="flex items-center gap-1.5 text-[11px] text-surface-500">
              <Loader2 className="w-3 h-3 animate-spin" /> Generating…
            </div>
          ) : rewrites.length === 0 ? (
            <p className="text-[11px] text-surface-500">No rewrites generated.</p>
          ) : (
            rewrites.map((r, i) => (
              <div key={i} className="flex items-start gap-1.5 bg-brand-900/20 border border-brand-800/40 rounded-md px-2 py-1.5">
                <p className="flex-1 text-[11px] text-brand-200 italic">"{r}"</p>
                <CopyButton text={r} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ViolationRow({ v, result, platform }: { v: FlagViolation; result: ScanResult; platform: FlagPlatform }) {
  const sev = SEVERITY_CONFIG[v.severity] ?? SEVERITY_CONFIG.medium;
  const out = OUTCOME_CONFIG[v.outcome] ?? OUTCOME_CONFIG["demonetization"];

  return (
    <div className="bg-surface-800 rounded-lg p-3 border border-surface-600">
      {/* Header row */}
      <div className="flex items-start gap-2 mb-1.5 flex-wrap">
        <span>{CATEGORY_ICON[v.category] ?? CATEGORY_ICON["Other"]}</span>
        <span className="text-white text-xs font-semibold flex-1">{v.category}</span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${sev.className}`}>
          {sev.label}
        </span>
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${out.className}`}>
          {out.label}
        </span>
        {v.time != null && (
          <span className="text-[10px] text-surface-500 tabular-nums">@{formatDuration(v.time)}</span>
        )}
      </div>

      {/* Copyright specifics */}
      {v.copyrightedWork && (
        <p className="text-[11px] text-purple-300 mb-1.5 flex items-center gap-1">
          ©️ <span className="font-medium">{v.copyrightedWork}</span>
          {v.contentIdRisk && (
            <span className={`ml-1 text-[10px] px-1 rounded ${
              v.contentIdRisk === "high" ? "bg-red-700 text-white" :
              v.contentIdRisk === "medium" ? "bg-amber-700 text-white" : "bg-surface-600 text-surface-300"
            }`}>Content-ID: {v.contentIdRisk} risk</span>
          )}
        </p>
      )}

      {v.quote && (
        <blockquote className="text-[11px] text-surface-400 italic border-l-2 border-surface-600 pl-2 mb-1.5 line-clamp-2">
          "{v.quote}"
        </blockquote>
      )}
      <p className="text-[11px] text-surface-300 mb-1">{v.explanation}</p>
      <p className="text-[10px] text-surface-500 mb-2">Policy: {v.policy}</p>

      {/* Fix suggestion */}
      {v.fix && (
        <div className="flex items-start gap-1.5 bg-green-950/50 border border-green-800/50 rounded-md px-2 py-1.5 mb-2">
          <Wrench className="w-3 h-3 text-green-400 mt-0.5 shrink-0" />
          <p className="flex-1 text-[11px] text-green-300">{v.fix}</p>
        </div>
      )}

      {/* Action row: Cut in editor + Rewrite */}
      <div className="flex items-center gap-2 flex-wrap">
        {result.kind === "clip" && v.time != null && (
          <Link
            href={`/editor/${result.id}?t=${Math.floor(v.time)}`}
            className="flex items-center gap-1 text-[10px] bg-surface-700 hover:bg-surface-600 text-white px-2 py-1 rounded transition-colors"
          >
            <Scissors className="w-3 h-3" /> Cut at {formatDuration(v.time)}
          </Link>
        )}
        {v.quote && <RewriteSection v={v} platform={platform} />}
      </div>
    </div>
  );
}

function SensitiveTopicsSection({ topics }: { topics: SensitiveTopic[] }) {
  if (topics.length === 0) return null;
  const riskColor = (r: string) =>
    r === "high" ? "text-red-400" : r === "medium" ? "text-amber-400" : "text-yellow-400";
  return (
    <div className="rounded-xl border border-yellow-800/40 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-yellow-900/10">
        <TrendingUp className="w-4 h-4 text-yellow-400 shrink-0" />
        <div>
          <p className="text-yellow-300 text-sm font-semibold">Trending Topic Radar</p>
          <p className="text-[11px] text-yellow-500">Contextually risky even without a clear policy violation</p>
        </div>
      </div>
      <div className="px-4 py-3 flex flex-col gap-2">
        {topics.map((t, i) => (
          <div key={i} className="bg-surface-800 rounded-lg p-3 border border-surface-700">
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-xs font-bold ${riskColor(t.risk)}`}>{t.topic}</span>
              <span className={`text-[10px] px-1 rounded bg-surface-700 ${riskColor(t.risk)}`}>{t.risk}</span>
            </div>
            <p className="text-[11px] text-surface-400">{t.reason}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultCard({ result, platform }: { result: ScanResult; platform: FlagPlatform }) {
  const { report } = result;
  const flagged = report.status === "flagged";
  return (
    <div className={`rounded-xl border overflow-hidden ${flagged ? "border-amber-700/50" : "border-surface-600"}`}>
      <div className={`flex items-center gap-3 px-4 py-3 ${flagged ? "bg-amber-900/20" : "bg-surface-800"}`}>
        {flagged
          ? <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          : <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
        }
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-semibold truncate">{result.title}</p>
          <p className={`text-xs mt-0.5 ${flagged ? "text-amber-300" : "text-green-400"}`}>{report.summary}</p>
        </div>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${flagged ? "bg-amber-600 text-white" : "bg-green-700 text-white"}`}>
          {flagged ? "FLAGGED" : "CLEAN"}
        </span>
      </div>

      <div className="px-4 py-2 bg-surface-900/50 border-t border-surface-700">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-3 h-3 text-surface-500" />
          <span className="text-[10px] text-surface-500 uppercase tracking-wider font-medium">Risk Score</span>
        </div>
        <ScoreBar score={report.riskScore} />
      </div>

      {report.violations.length > 0 && (
        <div className="px-4 py-3 bg-surface-900/30 border-t border-surface-700 flex flex-col gap-2">
          {report.violations.map((v, i) => (
            <ViolationRow key={i} v={v} result={result} platform={platform} />
          ))}
        </div>
      )}

      {report.sensitiveTopics?.length > 0 && (
        <div className="px-4 py-3 border-t border-surface-700">
          <SensitiveTopicsSection topics={report.sensitiveTopics} />
        </div>
      )}
    </div>
  );
}

export default function FlagResults({ results, platform, onClose }: Props) {
  const flaggedCount = results.filter((r) => r.report.status === "flagged").length;

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  const PLATFORM_LABEL: Record<FlagPlatform, string> = {
    youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram",
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="w-full max-w-2xl bg-surface-900 rounded-2xl border border-surface-600 shadow-2xl my-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-700">
            <AlertCircle className="w-5 h-5 text-brand-400" />
            <div className="flex-1">
              <h2 className="text-white font-bold">FlagPal Results</h2>
              <p className="text-xs text-surface-500 mt-0.5">
                {results.length} item{results.length !== 1 ? "s" : ""} scanned for {PLATFORM_LABEL[platform]}
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

          <div className="p-5 flex flex-col gap-4">
            {results.map((r) => (
              <ResultCard key={`${r.kind}-${r.id}`} result={r} platform={platform} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
