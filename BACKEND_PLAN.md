# Backend Plan — accounts, groups, shared statistics

> Status: **decided, not started.** Phase 0 (export/import) is done and shipped; phases 1–3 are
> the build. Online/real-time play is explicitly **out of scope** — see "Not doing".

## The decision: Supabase

A backend-as-a-service rather than a hand-written server, because the whole feature set is
"who is allowed to read which rows" and that is expressible as database policy.

- **It's Postgres.** The data is relational — users, groups, memberships, games. "Read a game
  iff you belong to its group" is one SQL line. In a document store it becomes denormalised
  membership arrays plus rule-language gymnastics.
- **Row-Level Security replaces the server entirely.** The browser talks to Postgres directly
  under policies enforced by the database. There is no API tier to write, host, secure, or pay
  for.
- **The site stays static.** The client loads as an ES module from a CDN, so GitHub Pages
  hosting and the project's no-build-step rule both survive.
- The anon key is *designed* to be public and is safe to commit. **RLS is the only security
  boundary** — which is why the policies below matter more than anything else in this file.

Firebase would also work (second choice). A hand-rolled Node+Postgres service was rejected:
strictly more work for strictly less.

## The modelling decision that actually matters

Today a "player" is a string in an array. The new model needs **two separate concepts**, and
conflating them is the mistake that is expensive to undo later:

| Concept | What it is |
|---|---|
| **user** | a real human with a login (`auth.users` / `profiles`) |
| **group member (seat)** | someone who plays in a group — *optionally* linked to a user |

Someone's cousin plays one game and never makes an account. Someone else plays as a guest for
six months, then signs up, and their whole history must follow them. Therefore:

- **Games reference member ids, never names.** Renaming a person must not rewrite history.
- **A member row carries a nullable `user_id`.** Linking a guest to a real account later is one
  `UPDATE`, not a migration.

## Schema

```sql
create table profiles (
  id          uuid primary key references auth.users on delete cascade,
  display_name text not null,
  created_at  timestamptz not null default now()
);

create table groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references profiles(id),
  invite_code text unique not null,          -- shareable join link
  created_at  timestamptz not null default now()
);

-- the seat identity: a person who plays in this group, account optional
create table group_members (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references groups(id) on delete cascade,
  display_name text not null,
  user_id      uuid references profiles(id),   -- null = guest
  role         text not null default 'member', -- 'owner' | 'member'
  created_at   timestamptz not null default now(),
  unique (group_id, user_id)                   -- an account joins a group once
);

create table games (
  id           uuid primary key,              -- CLIENT-generated; see "Sync"
  group_id     uuid not null references groups(id) on delete cascade,
  created_by   uuid not null references profiles(id),
  played_at    timestamptz not null,
  player_count int  not null,
  seats        jsonb not null,   -- ordered [group_member_id, …] = seat index → person
  events       jsonb not null,   -- the event log, verbatim
  round_mods   jsonb not null,
  result       jsonb not null,   -- { winner, hitlerIdx, fascistIdxs }
  created_at   timestamptz not null default now()
);
create index on games (group_id, played_at desc);
```

**Keep `events` as `jsonb`.** Do not normalise it into rows. `derive()` already rebuilds the
entire game from the event log, so the database only needs to hand back the same object
`saveRoles()` writes today. That is why this is a much smaller change than it looks:
`js/stats.js` keeps aggregating over an array of game records — the array just arrives from
Postgres instead of `localStorage`. **Group statistics then come for free**, with no new
statistics code at all.

## Row-Level Security

```sql
alter table groups        enable row level security;
alter table group_members enable row level security;
alter table games         enable row level security;

-- SECURITY DEFINER breaks the recursion described below
create function my_group_ids() returns setof uuid
  language sql security definer stable set search_path = public as $$
  select group_id from group_members where user_id = auth.uid()
$$;

create policy "read games in my groups" on games for select
  using (group_id in (select my_group_ids()));

create policy "record games in my groups" on games for insert
  with check (group_id in (select my_group_ids()) and created_by = auth.uid());

create policy "see my groups" on groups for select
  using (id in (select my_group_ids()));

create policy "see co-members" on group_members for select
  using (group_id in (select my_group_ids()));
```

**Known gotcha, budget for it:** a policy *on* `group_members` that itself queries
`group_members` recurses infinitely and Postgres will reject the query. The `security definer`
function above is the standard fix — it runs outside RLS and breaks the cycle. Hitting this
blind costs an evening; knowing it costs nothing.

## Sync strategy: local-first

This app is used at a table, on someone's phone, on a hotspot in a basement. **The network is
not allowed to be on the critical path of recording a game.**

- `localStorage` stays the write path exactly as it works today. The app keeps working with no
  account and no connection.
- Games sync to Postgres in the background and on reconnect.
- **Every game carries a client-generated UUID** (shipped — `Stats.uuid()`, backfilled onto
  legacy records). That is the idempotency key: an interrupted sync can be retried, and the
  same game can never be inserted twice. This is why `games.id` above has no `default` — the
  client supplies it.
- Reconciliation is an `upsert` on that id. Games are append-only and never edited after
  recording, so there is no merge conflict to resolve.

## Phases

| # | Phase | Contents |
|---|---|---|
| 0 | **Export / import** ✅ done | JSON backup + merge-by-id. Doubles as the account-seeding payload. |
| 1 | **Auth + personal cloud sync** | Login, `profiles`, upload/download own games. No groups. Proves the whole pipe: RLS, sync, conflicts. |
| 2 | **Groups** | `groups` + `group_members` + invite codes; group stats reuse `renderStatsInto()` over a different game list. |
| 3 | **Link seats to accounts** | Attach a `user_id` to an existing member; "my stats across all groups". Friends, if still wanted, are a two-person group. |

**On first login, offer to upload the local archive** — that is precisely what phase 0's export
payload is, which is why it was built first.

## Not doing

- **Online/real-time play.** Explicitly descoped. Supabase Realtime remains available if that
  ever changes, but nothing here depends on it.
- **A friend graph, initially.** Requests, pending/accepted states and blocking are real work,
  and groups do the actual job. Ship invite links first; revisit only if groups prove
  insufficient in practice.

## Operational notes

- Free-tier Supabase projects pause after a stretch of inactivity — expect a cold start if
  game nights are weeks apart.
- Keep `localStorage` working forever as the offline path; the cloud is a sync target, never a
  requirement.
