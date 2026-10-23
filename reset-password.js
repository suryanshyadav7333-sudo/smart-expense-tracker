
const resetForm = document.getElementById("resetForm");
const resetMessage = document.getElementById("resetMessage");
const resetButton = document.getElementById("resetButton");

let recoverySessionReady = false;

function showResetMessage(message, isError = false) {
  resetMessage.textContent = message;
  resetMessage.style.color = isError ? "#c45142" : "#248e69";
}

// Check whether Supabase restored the session from the reset email.
async function checkRecoverySession() {
  resetButton.disabled = true;
  showResetMessage("Verifying your reset link...");

  try {
    const { data, error } =
      await supabaseClient.auth.getSession();

    if (error) throw error;

    if (data.session) {
      recoverySessionReady = true;
      resetButton.disabled = false;
      showResetMessage("Link verified. You can set your new password.");
    } else {
      recoverySessionReady = false;
      showResetMessage(
        "No recovery session found. Return to login and request a NEW password reset email.",
        true
      );
    }
  } catch (error) {
    console.error("Recovery session error:", error);
    recoverySessionReady = false;
    showResetMessage(
      "Could not verify your reset link. Request a new password reset email.",
      true
    );
  }
}

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!recoverySessionReady) {
    showResetMessage(
      "Your reset link has not been verified. Request a new reset email.",
      true
    );
    return;
  }

  const password =
    document.getElementById("newPassword").value;

  const confirmPassword =
    document.getElementById("confirmPassword").value;

  if (password.length < 8) {
    showResetMessage(
      "Your password must contain at least 8 characters.",
      true
    );
    return;
  }

  if (password !== confirmPassword) {
    showResetMessage("The passwords do not match.", true);
    return;
  }

  resetButton.disabled = true;
  resetButton.textContent = "Updating password...";
  showResetMessage("");

  try {
    // Verify the recovery session is still available.
    const { data: sessionData, error: sessionError } =
      await supabaseClient.auth.getSession();

    if (sessionError) throw sessionError;

    if (!sessionData.session) {
      recoverySessionReady = false;
      throw new Error(
        "Your recovery session has expired. Request a new reset email."
      );
    }

    const { error } = await supabaseClient.auth.updateUser({
      password: password
    });

    if (error) throw error;

    recoverySessionReady = false;
    resetForm.reset();

    showResetMessage(
      "Password updated successfully! Redirecting to login..."
    );

    setTimeout(() => {
      window.location.href = "login.html";
    }, 2000);

  } catch (error) {
    console.error("Password update error:", error);

    showResetMessage(
      error.message ||
      "Could not update your password. Request a new reset email.",
      true
    );
  } finally {
    resetButton.disabled = false;
    resetButton.textContent = "Update password";
  }
});

// Run the session check when the page opens.
checkRecoverySession();
