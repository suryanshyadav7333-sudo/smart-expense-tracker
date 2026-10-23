
const resetForm = document.getElementById("resetForm");
const resetMessage = document.getElementById("resetMessage");
const resetButton = document.getElementById("resetButton");

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = document.getElementById("newPassword").value;
  const confirmPassword =
    document.getElementById("confirmPassword").value;

  if (password !== confirmPassword) {
    resetMessage.textContent = "The passwords do not match.";
    resetMessage.style.color = "#c45142";
    return;
  }

  resetButton.disabled = true;
  resetButton.textContent = "Updating password...";
  resetMessage.textContent = "";

  try {
    const { error } = await supabaseClient.auth.updateUser({
      password: password
    });

    if (error) throw error;

    resetMessage.textContent =
      "Password updated successfully! You can now log in.";

    resetMessage.style.color = "#248e69";
    resetForm.reset();

    setTimeout(() => {
      window.location.href = "login.html";
    }, 2000);

  } catch (error) {
    console.error("Password update error:", error);

    resetMessage.textContent =
      "Could not update the password. The reset link may have expired. Request a new one from the login page.";

    resetMessage.style.color = "#c45142";
  } finally {
    resetButton.disabled = false;
    resetButton.textContent = "Update password";
  }
});
