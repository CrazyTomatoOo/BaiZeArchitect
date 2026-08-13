/**
 * 0012-run-event-stream.ts — Run-local model execution event stream.
 *
 * Run events carry token/tool/result/process facts for a single Run on a
 * contiguous per-Run sequence. They are immutable audit facts, separate from
 * the Workflow governance event stream (which never carries token data).
 */
export const RUN_EVENT_STREAM_MIGRATION = {
	version: 12,
	name: "0012-run-event-stream",
	sql: `
create table run_events(
	id integer primary key,
	run_id integer not null references runs(id),
	seq integer not null,
	type text not null,
	schema_version text not null default 'run-event/v1',
	payload text not null,
	created_at text not null,
	unique(run_id, seq)
);

create trigger run_events_contiguous_seq
before insert on run_events
when new.seq <> (select coalesce(max(seq), 0) + 1 from run_events where run_id = new.run_id) begin
	select raise(abort, 'Run event sequence must be contiguous per Run');
end;

create trigger run_events_no_update
before update on run_events begin
	select raise(abort, 'Run events are immutable');
end;

create trigger run_events_no_delete
before delete on run_events begin
	select raise(abort, 'Run events are immutable');
end;
`,
	checksum: "run-event-stream-v1",
} as const;
