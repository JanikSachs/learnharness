import assert from "node:assert/strict";
import { test } from "node:test";
import { timeZoneOptions } from "../components/settings/agent-section.tsx";

test("time zone options include UTC and an alias saved zone, deduped and sorted", () => {
	const out = timeZoneOptions(["Europe/Berlin", "America/New_York"], "US/Eastern");
	assert.deepEqual(out, ["America/New_York", "Europe/Berlin", "US/Eastern", "UTC"]);
	assert.deepEqual(timeZoneOptions(["UTC", "Europe/Berlin"], "UTC"), ["Europe/Berlin", "UTC"]);
});
