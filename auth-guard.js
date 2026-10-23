
(async function protectDashboard() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error || !data.session) {
    window.location.replace("login.html");
    return;
  }

  // The dashboard can be shown after a valid session is found.
  document.body.style.visibility = "visible";
})();
