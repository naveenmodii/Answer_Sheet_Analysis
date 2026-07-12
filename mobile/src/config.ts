/**
 * SIPAR — Backend API configuration
 *
 * Change API_BASE_URL here when moving between environments.
 *
 * Android emulator:  'http://10.0.2.2:8000'
 *   → 10.0.2.2 is the emulator's alias for the host machine's localhost.
 *
 * Physical Android device (USB/Wi-Fi):  'http://<your-machine-LAN-IP>:8000'
 *   → Find your IP with: ifconfig | grep "inet " (macOS) or ipconfig (Windows)
 *
 * iOS simulator:  'http://localhost:8000'
 *   → Simulator shares the host network directly.
 *
 * Production / deployed:  'https://api.your-domain.com'
 */
export const API_BASE_URL = 'http://172.19.12.201:8000'; // Physical device → Mac LAN IP
