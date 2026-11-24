# Changelog

Fork-specific changes to OpenHop Repeater UI. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases are HydraHop versions (`MAJOR.MINOR.PATCH`), tagged `hydrahop-vX.Y.Z` across the core, repeater, web UI and hub repositories. Releases up to 19 Nov 2026 used date tags (`kesh-YYYY.MM.DD`).

## [Unreleased]

## [1.8.0] - 2026-11-24

### Added

- **RF front-end controls under every radio.** Radio Hardware shows AGC reset, FEM gain and RX boost for each configured radio, not only the default, and the web terminal's `get`/`set` for those keys take an optional radio id. Upstream PR openhop-dev/openHop_RepeaterUI#132 by agessaman; needs the repeater's per-radio `/api/radio_frontend`.

## [1.7.0] - 2026-11-24

### Added

- **Upstream RepeaterUI dev merged (7 Nov 2026).** Brings RF front-end controls (AGC reset, FEM gain, RX boost) for KISS and openHop USB/TCP modems on Radio Hardware and in the web terminal, and network and per-broker MQTT usage on System Stats. The API client is regenerated from the merged repeater spec.

## [1.6.0] - 2026-11-22

### Added

- **Analytics → Antennas splits corrupted packets.** Two new rows estimate the share of CRC errors that follow our own sends (with CRC errors per send) and the rate from other causes; a finding explains when our sends account for 30% or more.

## [1.5.1] - 2026-11-21

### Changed

- **HydraHop menu marker is now a small fork icon** (tooltip "HydraHop feature") instead of the letters "HH", which are a hate symbol. The Dashboard card heading uses the same icon.

## [1.5.0] - 2026-11-21

### Added

- **HydraHop status on the Dashboard.** One card shows, per network, bridged and repeated packets (24 h), each antenna's identity codes, which antenna's copy neighbours relay more often when sent first, and Internet Link peers. Each part links to its page.
- **Retired one-byte codes are shown.** The Dashboard card and Analytics → Antennas warn when a one-byte antenna code was retired, naming the radio, the code and the relay that caused it. Crossing diagnostics lists one-byte codes with their path width and status.
- **HydraHop features are marked in the menu.** Bridge, Antennas, Bridge settings and Radio Names carry a small HydraHop marker, and pages changed in this release show a dot until opened.

## [1.4.0] - 2026-11-20

### Added

- **Antennas: which copy neighbours relayed.** Where two antennas send the same packet, the Antennas page shows, per antenna, how often neighbours relayed its copy, split by whether it went first or second, and which neighbours relayed which copy (from `GET /api/relay_stats`). It says when identity codes are off or copies cannot be told apart, and the rest of the page still loads if this part fails.

## [1.3.1] - 2026-11-20

### Fixed

- **Antennas page claimed every receiver sends in a TX group.** Column labels now come from the running topology: "receives and sends", "receives; sends bridged packets only", "receives only" or "shadow: compared live, not recorded".
- **Antennas page showed zeros where there was no data.** Cells say "No data", "Not recorded" (shadow radios) or "Does not send" instead.
- **Antennas signal finding compared different relays and led with RSSI.** It now uses the same radio frames only, leads with SNR, says how many frames it is based on, notes that RSSI is not calibrated across radio models, and declines to compare on fewer than 30 frames. Bridge echoes get their own row and are left out of the other figures.
- **Bridge page antenna codes** show the code actually sent (with "(own)" for this node's normal identity and a count of other codes seen), not today's alias settings. A failed history read shows an error rather than an empty page.

## [1.3.0] - 2026-11-20

### Added

- **Antennas page** (Analytics → Antennas). For each network with two or more antennas: who heard each packet (all antennas or only one), plain-language findings such as packets only one antenna caught and the signal difference between antennas, and a side-by-side table of signal, noise floor, corrupted packets, repeaters heard, sends and channel-busy waits. Reads `/api/antenna_stats`.

## [1.2.0] - 2026-11-20

### Added

- **Bridge page** (Analytics → Bridge). Packets bridged in each direction with a timeline, what each network heard, repeated, bridged or did not send (with plain-language reasons), and sends per antenna pair with each pair's antenna code. Windows: 1 h, 6 h, 24 h, 7 days. Reads `/api/bridge_stats`.

## [1.1.0] - 2026-11-19

### Changed

- No changes. Tagged so all four repositories share the HydraHop version.

## [1.0.3] - 2026-11-19

### Changed

- No changes. Tagged so all four repositories share the HydraHop version.

## [1.0.2] - 2026-11-19

### Changed

- No changes. Tagged so all four repositories share the HydraHop version.

## [1.0.1] - 2026-11-19

### Changed

- No changes. Tagged so all four repositories share the HydraHop version.

## [1.0.0] - 2026-11-19

### Changed

- **Versioning**: releases are now HydraHop semantic versions tagged `hydrahop-vX.Y.Z`; this is HydraHop 1.0.0. Date tags (`kesh-YYYY.MM.DD`) stay as history.
- **README** links to the hub for the current version instead of naming a release that went stale.
- **README** title names the fork HydraHop.

## [kesh-2026.11.19] - 2026-11-19

### Changed

- **README** points feedback and bug reports at the hub's issues, the single place for all four repositories.
- **README**: the Crossing operations section moved above Upstream and license.

## [kesh-2026.11.18.2] - 2026-11-19

### Added

- **Antenna identities setting** (Bridge settings → Transmitters): choose Off (single identity), Transmitting antenna, or Receiving + transmitting antenna codes. The choice applies on restart, with saved and running status and **Validate & restart…**.

## [kesh-2026.11.18.1] - 2026-11-18

### Added

- **Bridge control center**: Bridge settings become tabbed sections, with these additions (from the previously unmerged `fix/live-bridge-transmitters` branch, which the Pi has served since 2026-11-17):
  - **Channel links**: forward and reverse mappings are paired into two-way links (A → B only, B → A only, or both). Edits are drafted, then saved, and the page warns about responses lost in transit.
  - **Transmitters tab**: active and saved status, pending-restart marking, and **Validate & restart…**, combined with the bridged-only scope selector.
  - **Activity**: crossing filters (direction, outcome), pagination and per-crossing evidence, plus the antenna identity table.
  - **Internet Link panel**: a reworked layout that refreshes only while visible.
- **Radio names**: a Configuration → Radio Names tab sets display-only names for each radio, saved in `web.radio_labels`. Menus and labels across the UI (bridge, radio settings, radio hardware, companions, CAD calibration) use the saved name, falling back to the configured label or radio ID. Saving takes effect immediately without a restart and does not change radio IDs, frequencies or routing.

## [kesh-2026.11.18] - 2026-11-18

This is the first tagged fork release. It covers everything since the fork's upstream base, `openhop-dev/openHop_RepeaterUI` `dev` at `41cf17e` (2026-10-29).

### Added

- **Bridge settings**:
  - native configuration with write-only channel keys;
  - required, preserved home radios for bridge origins and companions;
  - independent opt-in direct-message routes.
- **Bridge controls**:
  - **Pause crossings now**;
  - per-channel and per-direction switches;
  - protocol transit options (discovery, repeater admin, TRACE);
  - peer routing mode.
- **Crossing diagnostics**:
  - directional traffic counters;
  - modem TX versus independent reception evidence;
  - the antenna identity code table.
- **Sequential transmitters**: an ordered pair per network, used for every packet or for bridged packets only.
- **Internet Link**: status, controls and the age of the last valid inbound frame from each peer.
- **CAD Calibration**:
  - choose and isolate the physical radio being calibrated;
  - an explicit, firmware-confirmed **CAD before transmit** switch per radio.
- **Broker settings**: the receive radio and region for each observer feed.
- **Dashboard and charts**: last RF reception on each radio panel, and configured radio names throughout.
- Fork README, CHANGELOG, CONTRIBUTING, SECURITY, a PR template, and CI (type-check, tests, build, and the API client checked against the repeater spec).

### Fixed

- The CSS bundle is built only from UI sources. Before, editing docs at the repository root changed the bundle.
- CAD calibration panels no longer collapse beneath the process log.
- Airtime chart test fixtures are unmounted before environment teardown.

### Security

- Frontend dependencies updated, with a minimum Vite version that includes upstream security fixes.
- Stored channel keys are never displayed or sent back; leave the key blank to keep it.

[Unreleased]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.8.0...kesh/bridge
[1.8.0]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.7.0...hydrahop-v1.8.0
[1.7.0]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.6.1...hydrahop-v1.7.0
[1.6.0]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.5.1...hydrahop-v1.6.0
[1.5.1]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.5.0...hydrahop-v1.5.1
[1.5.0]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.4.0...hydrahop-v1.5.0
[1.4.0]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.3.1...hydrahop-v1.4.0
[1.3.1]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.3.0...hydrahop-v1.3.1
[1.3.0]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.2.0...hydrahop-v1.3.0
[1.2.0]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.1.0...hydrahop-v1.2.0
[1.1.0]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.0.3...hydrahop-v1.1.0
[1.0.3]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.0.2...hydrahop-v1.0.3
[1.0.2]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.0.1...hydrahop-v1.0.2
[1.0.1]: https://github.com/kesh33w/openHop_RepeaterUI/compare/hydrahop-v1.0.0...hydrahop-v1.0.1
[1.0.0]: https://github.com/kesh33w/openHop_RepeaterUI/compare/kesh-2026.11.19...hydrahop-v1.0.0
[kesh-2026.11.19]: https://github.com/kesh33w/openHop_RepeaterUI/compare/kesh-2026.11.18.2...kesh-2026.11.19
[kesh-2026.11.18.2]: https://github.com/kesh33w/openHop_RepeaterUI/compare/kesh-2026.11.18.1...kesh-2026.11.18.2
[kesh-2026.11.18.1]: https://github.com/kesh33w/openHop_RepeaterUI/compare/kesh-2026.11.18...kesh-2026.11.18.1
[kesh-2026.11.18]: https://github.com/kesh33w/openHop_RepeaterUI/compare/41cf17e...kesh-2026.11.18
