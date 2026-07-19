import test from "node:test";
import assert from "node:assert/strict";
import { applyNoteTimestamps, isoZulu, isoLocalOffset, isValidOkfTimestamp, timestampEligible } from "../dist/kosmos-core.mjs";

test("portable timestamps use canonical UTC Zulu and preserve creation",()=>{
  const fm={created_at:"2026-01-01T00:00:00.000Z"};
  assert.equal(applyNoteTimestamps(fm,0,Date.UTC(2026,6,18,12,34,56)),true);
  assert.equal(fm.created_at,"2026-01-01T00:00:00.000Z");
  assert.equal(fm.updated_at,"2026-07-18T12:34:56.000Z");
  assert.match(isoZulu(0),/Z$/);
});
test("editable OKF+ 2.2 uses its compact timestamp and does not regain beta.10 boilerplate",()=>{
  const fm={okf_version:"2.2",timestamp:"2026-01-01T00:00:00.000Z"};
  assert.equal(applyNoteTimestamps(fm,Date.UTC(2026,0,1),Date.UTC(2026,6,18)),false);
  assert.equal(fm.timestamp,"2026-01-01T00:00:00.000Z");
  assert.equal(fm.created_at,undefined);
  assert.equal(fm.updated_at,undefined);
  const missing={okf_version:"2.2"};
  assert.equal(applyNoteTimestamps(missing,Date.UTC(2026,0,2),Date.UTC(2026,6,18)),true);
  assert.equal(missing.timestamp,"2026-01-02T00:00:00.000Z");
});

test("local-offset timestamps carry an explicit numeric UTC offset and round-trip",()=>{
  const ms=Date.UTC(2026,6,19,18,42,7,123);
  const local=isoLocalOffset(ms);
  assert.match(local,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  assert.equal(Date.parse(local),ms); // same instant regardless of zone
  // offset must equal the environment's own computation — never naive wall-clock
  const off=-new Date(ms).getTimezoneOffset();
  const sign=off>=0?"+":"-";
  const hh=String(Math.floor(Math.abs(off)/60)).padStart(2,"0");
  const mm=String(Math.abs(off)%60).padStart(2,"0");
  assert.ok(local.endsWith(`${sign}${hh}:${mm}`));
});
test("Zulu remains the default and is byte-for-byte unchanged",()=>{
  const fm={};
  applyNoteTimestamps(fm,Date.UTC(2026,0,1),Date.UTC(2026,6,18,12,34,56));
  assert.equal(fm.created_at,"2026-01-01T00:00:00.000Z");
  assert.equal(fm.updated_at,"2026-07-18T12:34:56.000Z");
});
test("applyNoteTimestamps honors the local-timezone option",()=>{
  const fm={};
  assert.equal(applyNoteTimestamps(fm,Date.UTC(2026,0,1),Date.UTC(2026,6,18,12,0,0),{useLocalTimezone:true}),true);
  assert.match(fm.created_at,/[+-]\d{2}:\d{2}$/);
  assert.match(fm.updated_at,/[+-]\d{2}:\d{2}$/);
  assert.equal(Date.parse(fm.updated_at),Date.UTC(2026,6,18,12,0,0));
});
test("applyNoteTimestamps writes custom keys when configured and leaves the canonical pair untouched",()=>{
  const fm={};
  assert.equal(applyNoteTimestamps(fm,Date.UTC(2026,0,1),Date.UTC(2026,6,18),{createdKey:"created",updatedKey:"modified"}),true);
  assert.equal(fm.created,"2026-01-01T00:00:00.000Z");
  assert.equal(fm.modified,"2026-07-18T00:00:00.000Z");
  assert.equal(fm.created_at,undefined);
  assert.equal(fm.updated_at,undefined);
});
test("stamping an already-current note is a no-op write (anti-loop)",()=>{
  const fm={created_at:"2026-01-01T00:00:00.000Z",updated_at:"2026-07-18T12:34:56.000Z"};
  assert.equal(applyNoteTimestamps(fm,0,Date.UTC(2026,6,18,12,34,56)),false);
});
test("OKF timestamp validation accepts Zulu and numeric offsets, rejects naive wall-clock",()=>{
  assert.equal(isValidOkfTimestamp("2026-07-18T12:34:56.000Z"),true);
  assert.equal(isValidOkfTimestamp("2026-07-01T00:00:00Z"),true);
  assert.equal(isValidOkfTimestamp("2026-07-19T14:42:07-04:00"),true);
  assert.equal(isValidOkfTimestamp("2026-07-19T14:42:07.000+05:30"),true);
  assert.equal(isValidOkfTimestamp("2026-07-19T14:42:07"),false); // no zone designator
  assert.equal(isValidOkfTimestamp("not-a-date"),false);
});

test("timestamp eligibility excludes plugin and OKF internals",()=>{
  assert.equal(timestampEligible("Notes/A.md","md"),true);
  assert.equal(timestampEligible(".obsidian/plugins/x.md","md"),false);
  assert.equal(timestampEligible(".okf/diagnostics/x.md","md"),false);
});
