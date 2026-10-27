/**
 * SwarmTales website entry point: fonts, styles, then start the app.
 * The page is split by feature: src/app/ holds what every page shares
 * (state, wallet window, sending, routing), src/pages/ one file per page or
 * panel. See src/app/shell.js for the routes.
 */
import "@fontsource/literata/latin-400.css";
import "@fontsource/literata/latin-400-italic.css";
import "@fontsource/literata/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "./style.css";

import { boot } from "./app/shell.js";
import { registerServiceWorker } from "./lib/offline.js";
import { isFramed } from "./lib/frame.js";

boot();
// Offline opening and "install on home screen" (the built site only).
if (import.meta.env && import.meta.env.PROD && !isFramed(window)) registerServiceWorker();
