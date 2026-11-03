# Step 1: the live source (Divvy GBFS)

Divvy publishes its live data as **GBFS** (General Bikeshare Feed Specification, v1.1),
an open standard used by roughly a thousand bike-share systems worldwide. No key,
no sign-up. The index is `https://gbfs.divvybikes.com/gbfs/gbfs.json`; Dockcheck uses
two of the feeds it lists.

Samples saved in [`source-samples/`](./source-samples/), trimmed to 22 stations
(five near UChicago, ten that changed, four that only sent a heartbeat, two silent
dock stations, two lightweight stations, one not renting).

## Called twice, six minutes apart (Mon Nov 2, 8:20 PM and 8:27 PM)

| | 8:20 PM | 8:27 PM |
|---|---|---|
| Feed `last_updated` | 20:19:41 | 20:25:41 |
| Stations | 2,079 | 2,079 (none added or removed) |
| Stations whose `last_reported` moved | | **1,157** |
| Stations whose **counts or flags** changed | | **153** |

Of the 153 changes: 128 in bikes available, 106 in e-bikes, 103 in docks available,
41 in disabled bikes. For example:

| Station | What changed |
|---|---|
| University Ave & 57th St (by campus) | bikes **2 → 0**, docks 45 → 47 |
| Broadway & Glenlake Ave | bikes 12 → 13, docks **1 → 0** (now full) |
| Wabash Ave & Wacker Pl | bikes 11 → 10, docks 17 → 18 |
| Ada St & Washington Blvd | disabled bikes 3 → 2, nothing a rider would notice |

**What this means for the worker:** `last_reported` is a heartbeat. If "changed" meant
"`last_reported` moved", the worker would write ~1,157 rows every few minutes instead of
~153, and every one of those writes is a Realtime message to every open page. So a
station counts as **changed only when a field a rider cares about changed** (see below).

## Ask your agent: "Explain this response: what each field means, how often it changes, and which fields my app needs."

### The envelope (every feed)

| Field | Meaning | How often it changes |
|---|---|---|
| `last_updated` | When Divvy built this file (Unix seconds) | About every 60 s |
| `ttl` | Seconds Divvy says the file stays valid: **60** | Fixed |
| `version` | GBFS version: `1.1` | Fixed |

So polling more often than every ~60 s mostly returns the same file. The worker runs
every 10 s anyway (the brief's suggested starting point), and most runs will save
**zero rows**, which the runs table will show.

### `station_status.json`: one entry per station, the live part

| Field | Meaning | Changes | App needs it? |
|---|---|---|---|
| `station_id` | Stable id (two formats: long numbers and UUIDs) | Never | **Yes**, the key |
| `num_bikes_available` | Rentable bikes, **classic + e-bikes together** | Every few minutes at busy stations | **Yes** |
| `num_ebikes_available` | How many of those are e-bikes | Same | **Yes** (classic = bikes − ebikes) |
| `num_docks_available` | Empty docks you can return a bike to | Same | **Yes**, the "can I end my trip here?" answer |
| `num_bikes_disabled` | Broken bikes sitting in docks | Occasionally | Yes, to explain "docks look full but 0 bikes" |
| `num_docks_disabled` | Broken docks | Rarely | Yes, same reason |
| `is_installed` / `is_renting` / `is_returning` | 1/0 flags: can you take or return a bike here at all? (18 stations were not renting) | Rarely | **Yes**: "0 bikes" and "closed" are different answers |
| `last_reported` | When this station last phoned home (Unix seconds) | Every report, even with no change: a heartbeat | **Yes, but not as a change trigger** (see below) |
| `num_scooters_available` / `num_scooters_unavailable` | Scooters (always 0 here) | — | No |
| `legacy_id`, `eightd_has_available_keys` | Old id, key-dispenser flag | — | No |

### `station_information.json`: one entry per station, the slow part

| Field | Meaning | Changes | App needs it? |
|---|---|---|---|
| `station_id` | Same id as in status | Never | **Yes** |
| `name` | e.g. "University Ave & 57th St" | Rarely | **Yes** |
| `lat`, `lon` | Location | Rarely | **Yes**, for backups nearby and walking distance |
| `capacity` | Total docks | Rarely | Yes, to show "6 of 15" |
| `station_type` | `classic` (1,177) or `lightweight` (902) | Rarely | **Yes**, see below |
| `short_name`, `has_kiosk`, `rental_methods`, `rental_uris`, `external_id`, … | Metadata | Rarely | No |

This changes on the scale of days, not seconds, so the worker refreshes it rarely
(not every 10 s).

## Two surprises the data showed

1. **"Lightweight" stations barely report.** 916 stations had not reported in over an
   hour; **902 of them are `lightweight`**: e-bike lock-up spots with no real docks
   (812 have capacity 0), many silent for over a year. Only **14 dock stations** were
   genuinely silent. So a station's age matters *per station*: "this station hasn't
   reported in 3 hours" is its own state, separate from "our worker is down".
2. **Bikes available includes e-bikes.** 5 bikes with 5 e-bikes means zero classic bikes.
   The app shows both, since e-bikes cost extra.

## What Dockcheck keeps

Per station: `station_id`, `name`, `lat`, `lon`, `capacity`, `station_type`,
`bikes` (`num_bikes_available`), `ebikes`, `docks`, `bikes_disabled`, `docks_disabled`,
`is_renting`, `is_returning`, `is_installed`, `reported_at` (`last_reported`).

**"Changed"** = any of `bikes`, `ebikes`, `docks`, `bikes_disabled`, `docks_disabled`,
`is_renting`, `is_returning`, `is_installed` differs from what we have saved. How
`reported_at` stays accurate without turning every heartbeat into a write is decided in
Step 3 (the data flow).
