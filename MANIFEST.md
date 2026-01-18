# Miro App Manifest Configuration

This document describes the required Miro app configuration for **Annotate**.

## App Settings (Configure in Miro Developer Dashboard)

1. **App Name**: `Annotate`
2. **App Type**: Panel app
3. **App ID**: (Get this from your Developer Dashboard - use it in `src/config.js`)

## Required Permissions

The app requires the following permissions:

- **`boards:read`** - Read board items and selection state
- **`boards:write`** - Write metadata to board items

### Permission Justification

- **`boards:read`**: Required to read selected items and determine which item to annotate.
- **`boards:write`**: Required to store annotation metadata on board items using `item.setMetadata()`.

## App Configuration

1. Go to [Miro Developer Dashboard](https://developers.miro.com/apps)
2. Select your app (or create a new app)
3. Configure:
   - **App URL**: `http://localhost:3000` (for development)
   - **App Type**: Panel
   - **Permissions**: Enable `boards:read` and `boards:write`

## Environment Variables

Set in `.env` or `.env.local`:

```env
VITE_MIRO_APP_ID=your-actual-app-id-here
VITE_ENABLE_LOGGING=true
```

## Notes

- The manifest configuration is done in the Miro Developer Dashboard, not via a file.
- App ID should be configured in `src/config.js` or via `VITE_MIRO_APP_ID` environment variable.
- For production, update the App URL in the dashboard to your hosted URL.

