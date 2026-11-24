(() => {
  const url = window.FLIMCODE_SUPABASE_URL;
  const key = window.FLIMCODE_SUPABASE_ANON_KEY;
  const configured = url && key &&
    !url.includes("YOUR_SUPABASE_") &&
    !key.includes("YOUR_SUPABASE_");

  window.flimcodeSupabase = configured
    ? window.supabase.createClient(url, key)
    : null;
})();
