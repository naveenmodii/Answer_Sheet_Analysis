/**
 * SIPAR — Backend API configuration
 *
 * ── How to switch environments ─────────────────────────────────────────────
 *
 * 1. Set ENV to 'development' while testing on a device connected to your Mac.
 * 2. Set ENV to 'production' once your backend is deployed on Render and paste
 *    the Render URL into PROD_API_URL below.
 *
 * That's the only line you need to change — nothing else in the codebase.
 *
 * ── Local development notes ────────────────────────────────────────────────
 *   Android emulator:       'http://10.0.2.2:8000'
 *   Physical Android/iOS:   'http://<your-Mac-LAN-IP>:8000'
 *     → Find your LAN IP:  ifconfig | grep "inet " (macOS)
 *   iOS Simulator:          'http://localhost:8000'
 * ──────────────────────────────────────────────────────────────────────────
 */

const ENV: 'development' | 'production' = 'development';

/** Change to your Mac's LAN IP when testing on a physical device. */
const DEV_API_URL = 'http://172.19.12.201:8000';

/** Paste your Render Web Service URL here after deploying (see DEPLOYMENT.md). */
const PROD_API_URL = 'https://sipar-backend.onrender.com'; // ← replace with actual URL

export const API_BASE_URL = ENV === 'production' ? PROD_API_URL : DEV_API_URL;
