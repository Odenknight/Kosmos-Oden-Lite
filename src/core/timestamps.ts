/** Portable Obsidian note timestamps. Values default to ISO-8601 UTC (Zulu);
 *  optionally ISO-8601 local time with an explicit numeric ±HH:MM UTC offset. */
export const CREATED_AT_FIELD = "created_at";
export const UPDATED_AT_FIELD = "updated_at";
export function isoZulu(value: number | Date = Date.now()): string { const date=value instanceof Date?value:new Date(value); if(!Number.isFinite(date.getTime()))throw new Error("Invalid timestamp"); return date.toISOString(); }

/** ISO-8601 local time with an explicit numeric UTC offset (never naive wall-clock).
 *  The offset is derived from Date.getTimezoneOffset(), e.g. 2026-07-19T14:42:07.000-04:00. */
export function isoLocalOffset(value: number | Date = Date.now()): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid timestamp");
  const p = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
  // getTimezoneOffset() is minutes that local is BEHIND UTC, so east-of-UTC is negative.
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}` +
    `${sign}${p(Math.floor(Math.abs(offsetMin) / 60))}:${p(Math.abs(offsetMin) % 60)}`;
}

/** Format a stamp as UTC Zulu (default) or local time with numeric offset. */
export function formatTimestamp(value: number | Date, useLocalTimezone = false): string {
  return useLocalTimezone ? isoLocalOffset(value) : isoZulu(value);
}

export interface TimestampOptions {
  /** false (default) = UTC Zulu; true = local ISO-8601 with numeric ±HH:MM offset. */
  useLocalTimezone?: boolean;
  /** Frontmatter key for the creation stamp (default "created_at"). */
  createdKey?: string;
  /** Frontmatter key for the modification stamp (default "updated_at"). */
  updatedKey?: string;
}

export function applyNoteTimestamps(frontmatter:Record<string,unknown>,createdMs:number,modifiedMs:number,opts:TimestampOptions={}):boolean{
  const useLocal = opts.useLocalTimezone === true;
  // OKF+ 2.2 intentionally stays compact and editable in Obsidian Properties.
  // Its `timestamp` is the stable event/creation time; do not re-inject the
  // beta.10 created_at/updated_at pair on every human edit. The 2.2 profile
  // uses the canonical `timestamp` key regardless of custom key settings.
  if(frontmatter.okf_version==="2.2"){
    if(typeof frontmatter.timestamp==="string"&&frontmatter.timestamp)return false;
    frontmatter.timestamp=formatTimestamp(createdMs, useLocal);return true;
  }
  const createdKey = opts.createdKey && opts.createdKey.trim() ? opts.createdKey.trim() : CREATED_AT_FIELD;
  const updatedKey = opts.updatedKey && opts.updatedKey.trim() ? opts.updatedKey.trim() : UPDATED_AT_FIELD;
  let changed=false;
  if(typeof frontmatter[createdKey]!=="string"||!frontmatter[createdKey]){frontmatter[createdKey]=formatTimestamp(createdMs, useLocal);changed=true;}
  const updated=formatTimestamp(modifiedMs, useLocal);
  if(frontmatter[updatedKey]!==updated){frontmatter[updatedKey]=updated;changed=true;}
  return changed;
}
export function timestampEligible(path:string,extension:string):boolean{const normalized=path.replace(/\\/g,"/").toLowerCase();return extension.toLowerCase()==="md"&&!normalized.startsWith(".obsidian/")&&!normalized.startsWith(".okf/");}
