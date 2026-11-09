# Kesh's OpenHop Repeater UI

This is the Vue 3 and TypeScript dashboard for [Kesh's OpenHop bridge](https://github.com/kesh33w/kesh-openhop-bridge). The `kesh/bridge` branch extends [OpenHop Repeater UI](https://github.com/openhop-dev/openHop_RepeaterUI) with channel-bridge settings, companion home radios and optional iLink controls.

Use it with the matching [Repeater fork](https://github.com/kesh33w/openhop_repeater/tree/kesh/bridge). A standalone frontend cannot provide the bridge or Internet Link APIs.

## Bridge controls

The Bridge page configures directional channel mappings, explicit-path direct-message routes, the origin home radio and queue limits. Companions have their own home-radio assignments on the Companions page.

- Add a reverse mapping or route when replies need to cross back.
- Stored channel keys never come back from the settings API. Leave a saved channel's replacement key blank to keep it.
- Saving bridge settings writes the configuration. It does not restart the service or transmit a packet. Restart OpenHop separately to apply those settings.
- Internet Link traffic limits apply immediately when the listener is running. They do not require a restart.

Internet Link shows approved peers, routes, connection state and the age of the last valid inbound frame. A connected session confirms TLS authentication. Neither connection state nor frame activity proves RF delivery or a recipient acknowledgment. Endpoint addresses, trust, peer approvals and enrollment permissions remain in the host configuration.

## Develop locally

Use Node.js 22.12 or later in the Node 22 series and the checked-in package lock. Start a compatible backend separately, then run:

```sh
git clone --branch kesh/bridge --single-branch https://github.com/kesh33w/openHop_RepeaterUI.git
cd openHop_RepeaterUI
npm ci
cp .env.example .env.local
npm run dev
```

Set `VITE_DEV_API_URL` in `.env.local` to your backend URL before starting Vite. The default is `http://localhost:8000`. The dev server proxies `/api` and `/auth` to that backend; WebSocket code uses the same setting. Use an account on that backend to sign in. Do not put channel keys or backend credentials in frontend environment variables.

The hub's [current component manifest](https://github.com/kesh33w/kesh-openhop-bridge/blob/kesh/openhop-bridge/components.current.json) pins a dated integration snapshot. It is separate from the original release manifest and may precede the latest branch tips.

## Check and build

```sh
npm run type-check
npm run test:unit -- --run --maxWorkers=2
npm run build-only
```

`npm run build` combines type checking and the production build. Vite writes to `../openhop_repeater/repeater/web/html` and empties that directory first. Check that the sibling path points to the intended Repeater checkout before building. This is an output directory, not a command to deploy or restart a running Pi.

To keep the build inside the UI checkout instead:

```sh
npm run build-only -- --outDir dist
```

Deploy the complete generated asset directory when updating a frontend, including the hashed MapLibre worker. Copying only the main JavaScript file breaks map loading.

`npm run api:generate` regenerates TypeScript from a sibling Repeater's `repeater/web/openapi.yaml`. It checks `../openhop_repeater` first, then `../openhop-repeater`. `npm run api:check` also fails if generation changes the tracked client. Both commands need that backend checkout.

`npm run lint` and `npm run format` rewrite source files. They are not read-only checks.

## Where to make changes

| Path | Purpose |
| --- | --- |
| [src/components/configuration/BridgeSettings.vue](src/components/configuration/BridgeSettings.vue) | Channel mappings, keys, home radio and direct routes |
| [src/components/configuration/InternetLinkSettings.vue](src/components/configuration/InternetLinkSettings.vue) | Link status and live traffic limits |
| [src/utils/api.ts](src/utils/api.ts) | API client |
| [src/generated/openapi.ts](src/generated/openapi.ts) | Generated backend types |
| [tests/bridgeSettings.test.ts](tests/bridgeSettings.test.ts) | Bridge validation and save behavior |
| [tests/internetLink.test.ts](tests/internetLink.test.ts) | Link controls, status and unsaved changes |
| [vite.config.ts](vite.config.ts) | Development proxy and build output |

## Maps

Dark mode uses [OpenFreeMap](https://tiles.openfreemap.org/styles/dark) through MapLibre and Leaflet. Light mode uses [OpenStreetMap tiles](https://tile.openstreetmap.org/{z}/{x}/{y}.png). The UI falls back to raster tiles if vector-map loading or WebGL fails.

Maps need browser internet access. No provider account or API key is required. Keep the attribution visible and follow the [OpenStreetMap tile policy](https://operations.osmfoundation.org/policies/tiles/), including its caching and offline-download restrictions.

## Upstream and license

OpenHop Repeater UI supplies the original dashboard, authentication, terminal, maps and other management pages. This fork adds the controls described above. The upstream project and its contributors retain their attribution under the [MIT License](LICENSE).

Report fork-specific problems in [this repository](https://github.com/kesh33w/openHop_RepeaterUI/issues). Include the UI and backend commits, browser and reproduction steps. Remove credentials and channel keys from screenshots and logs.

## Crossing operations

The Bridge page separates the saved configuration from the running bridge. Pending edits and saved changes do not change the active radio routes until OpenHop restarts. The running comparison includes channel key changes without exposing keys in either view.

- Disable a channel or individual mapping/transit direction without deleting its keys or radio selections. A disabled channel blocks mappings that use it as source or destination. Local group repeating and distinct-mode native local routing continue. A disabled legacy direct transit direction has no local fallback.
- Pause crossings immediately with **Pause crossings now**. Pause persists after restart and does not apply other pending edits. Queued crossings are invalidated when paused; resuming does not release old queued traffic. A transmission already in progress may finish. Local group repeating and distinct-mode native local routing continue; paused legacy direct transit has no local fallback.
- Discovery/path learning, repeater administration, and TRACE are independent opt-ins. The repeater-administration option also forwards ordinary flood direct messages and acknowledgments because encrypted CLI traffic cannot be distinguished from ordinary encrypted messages. They use the enabled protocol transit directions. Configure both directions when responses must return. Zero-hop discovery control packets and adverts stay local.
- Directional safeguards show the running flood rate and burst limits plus all-crossing pending limits, with admitted, rate-limited and queue-full counters. Editing limits requires a restart. The defaults (12 flood crossings/minute, burst 3, 16 pending per direction) are enforced even without a traffic_limits section, including after upgrade.
- Crossing diagnostics distinguish pending work, modem-confirmed TX, failed or uncertain TX, and independent reception reports. An allowlisted external receiver hearing a crossing is not an end-user delivery acknowledgment. Missing observer confirmation is not proof of failure.

Independent observer identities and approved broker feeds remain host-configured. When evidence is disabled or a feed is disconnected, the page says so instead of inferring success from local traffic. Diagnostics refresh every five seconds while visible; status refreshes never overwrite unsaved route edits. Failed refreshes retain the last values with a stale-data warning.

The bridge editor never sends the host-managed reception observer allowlist back in a settings save. If a save succeeds but refreshing status fails, the editor reports the saved result and marks the running comparison unknown until refreshed. A definite pause failure reports that the request changed no settings. An unknown outcome or lost response warns that work may still complete and requires a status refresh before another pause action.

Peer routing defaults to `legacy` for existing configurations. The saved-settings selector can explicitly select `distinct`, which separates native same-radio hops from the unsigned public crossing route identifier shown under running routes. Discovery, repeater administration and TRACE require distinct mode. Changing mode requires a restart and clearing/relearning cross-network contact paths; the UI preserves channel mappings and direction selections. Legacy mode retains the existing policy that a native bridge next hop on a configured ingress selects crossing, so it does not promise unchanged same-radio direct routing.
