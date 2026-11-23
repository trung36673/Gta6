# LUCIA: NIGHT CITY — Mobile 3D prototype

A night-only, neon open-world exploration prototype built with Three.js. It uses the three GLB assets supplied in the conversation.

## Included
- Lucia player model (with a simple fallback if the model fails to load)
- Cyberpunk city GLB, street grid, neon buildings, street lamps and night fog
- Manhole/vent props scattered around the map
- Wandering NPCs with simple idle/walk motion and a startled retreat reaction
- Mobile joystick, run and interact controls
- Mini-map and collectible neon points
- Opening loading screen

## Run locally
The game uses ES modules and GLB assets, so open it through a local web server (not `file://`).

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000` on the same device/network. Internet is required for the Three.js CDN imports in this prototype.

## Android packaging
This folder is the web game source, not a compiled APK. To create an Android app, install Node.js and Android Studio on a computer, then:

```bash
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

Build an APK from Android Studio using **Build > Build Bundle(s) / APK(s) > Build APK(s)**. Copy the contents of this project into the Capacitor `www` folder or use the included Vite setup below.

## Notes
- This is an early playable prototype, not a finished commercial-scale open world.
- NPC behavior, collisions, missions, traffic, interiors, save/load and optimization are planned expansion points.
- Combat and firearm mechanics are intentionally not included; interactions are non-violent arcade reactions.
