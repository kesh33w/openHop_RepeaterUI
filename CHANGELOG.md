# Changelog

Fork-specific changes to OpenHop Repeater UI. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Releases are tagged `kesh-YYYY.MM.DD`, and the same tag is used across the repeater, core, web UI and hub repositories.

## [Unreleased]

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

[Unreleased]: https://github.com/kesh33w/openHop_RepeaterUI/compare/kesh-2026.11.18...kesh/bridge
[kesh-2026.11.18]: https://github.com/kesh33w/openHop_RepeaterUI/compare/41cf17e...kesh-2026.11.18
