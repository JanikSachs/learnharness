"use client";

/**
 * The right-hand session panel (fork): one resizable slot with tabs —
 * Side question | Materials. Only one tab shows at a time. Materials lists
 * the tables and diagrams the tutor has shown (core/materials.ts), newest
 * first, each with "Go to message".
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Material } from "@/src/core";
import { MessageResponse } from "@/components/ai-elements/message";

export type RightPanelTab = "side" | "materials";

const WIDTH_KEY = "lh-right-panel-width";
const DEFAULT_WIDTH = 352; // 22rem
const MIN_WIDTH = 288; // 18rem
const MAX_FRACTION = 0.6;

function readWidth(): number {
	try {
		const stored = Number(window.localStorage.getItem(WIDTH_KEY));
		return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH;
	} catch {
		return DEFAULT_WIDTH;
	}
}

export function clampPanelWidth(width: number, areaWidth: number): number {
	return Math.round(Math.max(MIN_WIDTH, Math.min(width, Math.max(MIN_WIDTH, areaWidth * MAX_FRACTION))));
}

export function RightPanel({ tabs, active, onSelect, children }: {
	tabs: { id: RightPanelTab; label: string }[];
	active: RightPanelTab;
	onSelect: (tab: RightPanelTab) => void;
	children: ReactNode;
}) {
	const [width, setWidth] = useState(DEFAULT_WIDTH);
	const aside = useRef<HTMLElement>(null);
	useEffect(() => setWidth(readWidth()), []);
	const areaWidth = () => aside.current?.parentElement?.getBoundingClientRect().width ?? window.innerWidth;
	const startDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = aside.current?.getBoundingClientRect().width ?? DEFAULT_WIDTH;
		const area = areaWidth();
		let last = startWidth;
		const move = (e: PointerEvent) => { last = clampPanelWidth(startWidth + (startX - e.clientX), area); setWidth(last); };
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			try { window.localStorage.setItem(WIDTH_KEY, String(last)); } catch { /* private mode */ }
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	}, []);
	return (
		<aside ref={aside} aria-label="Session panel" data-testid="right-panel"
			style={{ width: clampPanelWidth(width, typeof window === "undefined" ? 2 * width : areaWidth()) }}
			className="relative flex shrink-0 flex-col border-l border-border bg-background">
			<div role="separator" aria-orientation="vertical" aria-label="Resize panel" data-testid="right-panel-resize"
				onPointerDown={startDrag}
				className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize hover:bg-primary/20" />
			<div role="tablist" className="flex shrink-0 gap-1 border-b border-border px-3 pt-2">
				{tabs.map((tab) => (
					<button key={tab.id} type="button" role="tab" aria-selected={tab.id === active} data-testid={`right-panel-tab-${tab.id}`}
						onClick={() => onSelect(tab.id)}
						className={cn("-mb-px cursor-pointer border-b-2 px-2 pb-1.5 text-xs font-medium",
							tab.id === active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
						{tab.label}
					</button>
				))}
			</div>
			<div role="tabpanel" className="flex min-h-0 flex-1 flex-col p-3">{children}</div>
		</aside>
	);
}

function when(timestamp: number): string {
	return new Date(timestamp).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function MaterialsList({ materials, focus, onGoTo, onClose }: {
	materials: readonly Material[];
	/** The item to scroll to; `n` changes on every open so a repeat click re-scrolls. */
	focus: { id: string; n: number } | null;
	onGoTo: (messageId: string) => void;
	onClose: () => void;
}) {
	const list = useRef<HTMLDivElement>(null);
	const [flash, setFlash] = useState<string | null>(null);
	useEffect(() => {
		if (!focus) return;
		list.current?.querySelector(`[data-material-item="${CSS.escape(focus.id)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
		setFlash(focus.id);
		const t = window.setTimeout(() => setFlash(null), 2_000);
		return () => window.clearTimeout(t);
	}, [focus]);
	const newestFirst = [...materials].reverse();
	return (
		<div data-testid="materials-panel" className="flex min-h-0 flex-1 flex-col">
			<div className="mb-2 flex items-center justify-between">
				<span className="text-xs text-muted-foreground">{materials.length} {materials.length === 1 ? "item" : "items"}</span>
				<button type="button" aria-label="Close materials" onClick={onClose}
					className="cursor-pointer rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
					<XIcon className="size-3.5" />
				</button>
			</div>
			<div ref={list} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
				{newestFirst.length === 0 && <p className="text-xs text-muted-foreground">Tables and diagrams the tutor shows will appear here.</p>}
				{newestFirst.map((item) => (
					<section key={item.id} data-material-item={item.id}
						className={cn("rounded-md border border-border p-2 transition-colors", flash === item.id && "border-primary bg-primary/5")}>
						<header className="mb-1 flex items-baseline gap-2 text-[11px] text-muted-foreground">
							<span className="font-mono">{item.id}</span>
							<span>{item.kind}</span>
							<span className="ml-auto tabular-nums">{when(item.timestamp)}</span>
						</header>
						<h3 className="mb-2 text-sm font-medium">{item.title}</h3>
						<div className="overflow-x-auto text-sm">
							<MessageResponse>{item.markdown}</MessageResponse>
						</div>
						<button type="button" data-testid="material-go-to" onClick={() => onGoTo(item.messageId)}
							className="mt-1 cursor-pointer text-xs text-primary underline-offset-2 hover:underline">
							Go to message
						</button>
					</section>
				))}
			</div>
		</div>
	);
}
