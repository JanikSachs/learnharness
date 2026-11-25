/**
 * Time context for the conversation agents (fork feature). Notes are
 * computed per request from the timestamps every record message already
 * carries; nothing is persisted. Same history in = same notes out, so the
 * model-visible prefix stays stable across turns (prompt caching, Claude
 * Code context reuse).
 *
 * Placement: after the first non-system message (start of chat), and after
 * any message ending a gap of GAP_MS or more. Never between an assistant
 * message and its tool results: the note moves past assistant messages and
 * whole runs of tool results.
 *
 * Browser-safe: pure logic, Intl only.
 */

import type { Message } from "@earendil-works/pi-ai";

export const GAP_MS = 3 * 60 * 60 * 1000;

export const TIME_RULE = `# Time

The app adds \`[app: time]\` notes: the learner's local date and time, and the gap since the previous message. They come from the app, not the learner.

When the learner states a time ("in two weeks", "exam on Friday"), convert it to an absolute date using the latest note, and use that date from then on. After a gap, reckon with the elapsed time before continuing a plan or schedule.`;

/** True when `timeZone` is an IANA name this runtime accepts. */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
	if (typeof timeZone !== "string" || !timeZone) return false;
	try {
		new Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
}

function formatMoment(ms: number, timeZone: string, weekday: boolean): string {
	const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
		timeZone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", hourCycle: "h23",
	}).formatToParts(ms).map((p) => [p.type, p.value]));
	const text = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
	return weekday ? `${parts.weekday} ${text}` : text;
}

function plural(n: number, unit: string): string {
	return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function formatGap(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	return days >= 1 ? `${plural(days, "day")} ${plural(hours, "hour")}` : `${plural(hours, "hour")} ${plural(minutes % 60, "minute")}`;
}

export function timeNoteText(now: number, previous: number | null, timeZone: string): string {
	const head = `[app: time] ${formatMoment(now, timeZone, true)} (${timeZone}).`;
	if (previous === null) return `${head}\nStart of this chat.`;
	return `${head}\nPrevious message: ${formatMoment(previous, timeZone, true)}.\nGap: ${formatGap(now - previous)}.`;
}

/** Insert computed time notes into an already-converted LLM history.
 *  `hasCompactionHead`: the first non-system message is a compaction
 *  summary, so the chat's start is not in view. */
export function withTimeNotes(messages: readonly Message[], timeZone: string, hasCompactionHead = false): Message[] {
	const out: Message[] = [];
	let previous: number | null = null;
	let first = true;
	let pending: { text: string; timestamp: number } | null = null;
	const flush = () => {
		if (!pending) return;
		out.push({ role: "user", content: [{ type: "text", text: pending.text }], timestamp: pending.timestamp });
		pending = null;
	};
	for (let i = 0; i < messages.length; i++) {
		const m = messages[i]!;
		out.push(m);
		if (m.role === "system") continue;
		const at = typeof m.timestamp === "number" ? m.timestamp : null;
		// The compaction head carries the compaction's time, not the
		// conversation's: it is neither the chat start nor a gap reference.
		if (at !== null && !(first && hasCompactionHead)) {
			if (first) pending = { text: timeNoteText(at, null, timeZone), timestamp: at };
			else if (previous !== null && at - previous >= GAP_MS) pending = { text: timeNoteText(at, previous, timeZone), timestamp: at };
			previous = at;
		}
		first = false;
		// Hold the note while the next message must stay adjacent: after an
		// assistant (its tool results follow) and inside a tool-result run.
		const next = messages[i + 1];
		if (m.role === "assistant") continue;
		if (m.role === "toolResult" && next?.role === "toolResult") continue;
		flush();
	}
	flush();
	return out;
}
