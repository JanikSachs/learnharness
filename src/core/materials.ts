/**
 * Materials (fork feature): the tables and mermaid diagrams the tutor has
 * shown, collected from the record. Ids are content-derived (`t3f9a2c`:
 * kind letter + FNV-1a hash of the normalised markdown), so changing what
 * counts as a material never shifts other items' ids; an item whose own
 * text changes stops resolving (its old links render as plain text)
 * instead of opening a different item.
 * The client lists them in the Materials panel; the request path adds
 * computed `[app: materials]` notes so the tutor can link back to them with
 * `[text](material:t3f9a2c)` (rule: src/agent/prompts/shared/45-materials.md).
 * Nothing is persisted: same record in, same ids out.
 *
 * Browser-safe: pure logic only.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { failedOutputCallIds, type LhMessage } from "./native-messages.ts";
import { QUESTION_TOOLS } from "./pending.ts";

export type MaterialKind = "table" | "diagram";

export interface Material {
	id: string;
	kind: MaterialKind;
	title: string;
	markdown: string;
	messageId: string;
	timestamp: number;
}

export const MATERIAL_SCHEME = "material:";
const TITLE_MAX = 80;

/** `material:t3f9a2c` → `t3f9a2c`; null for anything else. */
export function materialIdFromHref(href: string | undefined | null): string | null {
	if (!href?.startsWith(MATERIAL_SCHEME)) return null;
	const id = href.slice(MATERIAL_SCHEME.length);
	return /^[td][0-9a-z]{6}$/.test(id) ? id : null;
}

/** Kind letter + 6 base-36 chars of FNV-1a (32-bit) over the trimmed,
 *  whitespace-collapsed markdown. */
export function materialId(kind: MaterialKind, markdown: string): string {
	const text = markdown.trim().replace(/\s+/g, " ");
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `${kind === "table" ? "t" : "d"}${(hash % 36 ** 6).toString(36).padStart(6, "0")}`;
}

/** The tutor's learner-facing markdown, in content order. Failed calls are
 *  skipped; a question's `explanation` (already on the pending call) only
 *  counts once the learner's real answer exists. `question` is shown at once.
 *  Answer-commitment fields are never read. */
function visibleTexts(message: LhMessage, failedSend: ReadonlySet<string>, errored: ReadonlySet<string>, answered: ReadonlySet<string>): string[] {
	if (message.role !== "assistant") return [];
	const out: string[] = [];
	for (const block of message.content) {
		if (block.type === "text") out.push(block.text);
		else if (block.type === "toolCall") {
			const args = (block.arguments ?? {}) as Record<string, unknown>;
			let fields: string[] = [];
			if (block.name === "send_to_user") fields = failedSend.has(block.id) ? [] : ["message"];
			else if ((QUESTION_TOOLS as readonly string[]).includes(block.name) && !errored.has(block.id)) {
				fields = (block.name === "quiz" || block.name === "probe") && answered.has(block.id) ? ["question", "explanation"] : ["question"];
			}
			for (const field of fields) if (typeof args[field] === "string") out.push(args[field] as string);
		}
	}
	return out;
}

function clip(text: string): string {
	const t = text.replace(/\s+/g, " ").trim();
	return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

function plainHeading(text: string): string {
	return clip(text.replace(/[*_`]/g, "").replace(/#+\s*$/, ""));
}

const DELIMITER = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.replace(/[*_`]/g, "").trim());

function diagramFallbackTitle(source: string): string {
	const labels = [...source.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!.trim()).slice(0, 3);
	return clip(labels.length ? labels.join(", ") : "diagram");
}

/** Tables and mermaid fences in one markdown text, with their titles. */
export function extractFromMarkdown(text: string): { kind: MaterialKind; title: string; markdown: string }[] {
	const lines = text.split("\n");
	const out: { kind: MaterialKind; title: string; markdown: string }[] = [];
	let heading: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const fence = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(line);
		if (fence) {
			const marker = fence[1]!;
			let end = i + 1;
			while (end < lines.length && !lines[end]!.trim().startsWith(marker)) end++;
			if (fence[2] === "mermaid") {
				const body = lines.slice(i + 1, end).join("\n");
				out.push({ kind: "diagram", title: heading ?? diagramFallbackTitle(body), markdown: lines.slice(i, end + 1).join("\n") });
			}
			i = end;
			continue;
		}
		const h = /^\s{0,3}#{1,6}\s+(.+)$/.exec(line);
		if (h) { heading = plainHeading(h[1]!); continue; }
		if (line.includes("|") && i + 1 < lines.length && DELIMITER.test(lines[i + 1]!)) {
			let end = i + 2;
			while (end < lines.length && lines[end]!.includes("|") && lines[end]!.trim()) end++;
			const title = heading ?? clip(cells(line).filter(Boolean).join(" | ") || "table");
			out.push({ kind: "table", title, markdown: lines.slice(i, end).join("\n") });
			i = end - 1;
		}
	}
	return out;
}

/** Collect with each item's position in `messages`. */
function collectIndexed(messages: readonly LhMessage[]): { index: number; item: Material }[] {
	const failedSend = failedOutputCallIds(messages);
	const errored = new Set<string>();
	const answered = new Set<string>();
	for (const m of messages) {
		if (m.role !== "toolResult") continue;
		if (m.isError) errored.add(m.toolCallId);
		// Real answers carry details; the transient "Question posed" ack has none.
		else if (m.details != null && !(m.details as { dismissed?: boolean }).dismissed) answered.add(m.toolCallId);
	}
	const out: { index: number; item: Material }[] = [];
	messages.forEach((message, index) => {
		if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") return;
		for (const text of visibleTexts(message, failedSend, errored, answered)) {
			for (const item of extractFromMarkdown(text)) {
				out.push({ index, item: { id: materialId(item.kind, item.markdown), ...item, messageId: message.id, timestamp: message.timestamp } });
			}
		}
	});
	return out;
}

/** Every material occurrence in the record, in record order (a repeated
 *  item appears once per message, with the same id). Failed or aborted
 *  generations never reached the learner and are skipped. */
export function collectMaterials(messages: readonly LhMessage[]): Material[] {
	return collectIndexed(messages).map((x) => x.item);
}

/** One entry per id, first occurrence wins (the panel's list). */
export function uniqueMaterials(items: readonly Material[]): Material[] {
	const seen = new Set<string>();
	return items.filter((item) => !seen.has(item.id) && (seen.add(item.id), true));
}

export function materialsNoteText(items: readonly Material[]): string {
	return ["[app: materials]", ...items.map((m) => `${m.id}: ${m.kind} "${m.title}"`)].join("\n");
}

/** Insert transient `[app: materials]` markers into the agent's message
 *  list (never the saved record) after each assistant message holding
 *  materials, past that message's tool results so a call and its result
 *  are never separated. toLlmMessages flattens them like any marker. */
export function withMaterialNotes(messages: readonly AgentMessage[]): AgentMessage[] {
	const records = messages as unknown as readonly LhMessage[];
	// Grouped by position: live steps may have no message id yet.
	const byMessage = new Map<number, Material[]>();
	for (const { index, item } of collectIndexed(records)) {
		const list = byMessage.get(index) ?? [];
		if (list.some((other) => other.id === item.id)) continue;
		list.push(item);
		byMessage.set(index, list);
	}
	if (byMessage.size === 0) return [...messages];
	const after = new Map<number, AgentMessage[]>();
	records.forEach((message, i) => {
		if (message.role !== "assistant") return;
		const items = byMessage.get(i);
		if (!items) return;
		const calls = new Set(message.content.flatMap((b) => (b.type === "toolCall" ? [b.id] : [])));
		let at = i;
		for (let j = i + 1; j < records.length; j++) {
			const r = records[j]!;
			if (r.role === "toolResult" && calls.has(r.toolCallId)) at = j;
		}
		while (records[at + 1]?.role === "toolResult") at++;
		// Shaped like a marker so toLlmMessages flattens it to user text. Its
		// customType is deliberately outside the record's (public) union: it
		// exists only inside convertToLlm and is never saved.
		const marker = {
			id: `materials-note-${i}`, role: "custom", customType: "materials-note",
			content: materialsNoteText(items), display: false, details: null,
			// The insertion point's time keeps time-note gaps honest.
			timestamp: records[at]!.timestamp,
		} as unknown as AgentMessage;
		after.set(at, [...(after.get(at) ?? []), marker]);
	});
	const out: AgentMessage[] = [];
	messages.forEach((message, i) => {
		out.push(message);
		for (const marker of after.get(i) ?? []) out.push(marker);
	});
	return out;
}
