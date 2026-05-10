// Copy this file to config.local.js and fill in real values.
// config.local.js is gitignored - never commit your keys.
window.RF_CONFIG = {
  // Your Supabase project URL (from the Supabase dashboard)
  SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',

  // Publishable / anon key - safe to expose in the browser. RLS protects your data.
  // Format: sb_publishable_... (preferred) or the legacy "eyJhbGc..." anon JWT.
  SUPABASE_ANON_KEY: 'sb_publishable_REPLACE_ME',

  // Google Maps JS API key. Restrict it to your deployed domain in
  // Google Cloud Console -> APIs & Services -> Credentials -> HTTP referrer.
  // Required APIs to enable on the project:
  //   Maps JavaScript API, Geocoding API, Distance Matrix API,
  //   Directions API, Routes API.
  GOOGLE_MAPS_KEY: 'YOUR_GOOGLE_MAPS_KEY',
};
