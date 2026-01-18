// App Configuration
// This file contains configuration for the Annotate Miro app

// IMPORTANT: Update APP_ID with your actual Miro app ID from the Developer Dashboard
// Get it from: https://developers.miro.com/apps -> Your App -> App Settings -> App ID
export const APP_ID = import.meta.env.VITE_MIRO_APP_ID || "annotate-app";

// Metadata namespace key (stored inside APP_ID metadata)
export const METADATA_KEY = "annotate";

// Schema version for metadata migrations
export const SCHEMA_VERSION = "1.0.0";

// Payload limits (Miro metadata limit is 6KB)
export const MAX_PAYLOAD_SIZE = 6 * 1024; // 6 KB in bytes

// Autosave debounce (300-500ms recommended)
export const AUTOSAVE_DEBOUNCE_MS = 400;

// Selection debounce to prevent re-render storms
export const SELECTION_DEBOUNCE_MS = 150;

// Environment flags
export const IS_DEVELOPMENT = import.meta.env.DEV;
export const IS_PRODUCTION = import.meta.env.PROD;

// Logging enabled (for development)
export const ENABLE_LOGGING =
  IS_DEVELOPMENT || import.meta.env.VITE_ENABLE_LOGGING === "true";
