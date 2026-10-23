
const loginForm = document.getElementById("loginForm");
const loginMessage = document.getElementById("loginMessage");
const loginButton = document.getElementById("loginButton");
const forgotPasswordLink = document.getElementById("forgotPasswordLink");

function showLoginMessage(message, isError = false) {
  loginMessage.textContent = message;
  loginMessage.style.color = isError ? "#c45142" : "#248e69";
}

// Normal login
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  loginButton.disabled = true;
  loginButton.textContent = "Logging in...";
  loginMessage.textContent = "";

  try {
    const { data, error } =
      await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

    if (error) throw error;

    if (data.session) {
      showLoginMessage("Login successful! Opening your dashboard...");
      window.location.href = "index.html";
    } else {
      showLoginMessage(
        "Login could not be completed. Please try again.",
        true
      );
    }
  } catch (error) {
    showLoginMessage(
      error.message || "Login failed. Please check your details.",
      true
    );
  } finally {
    loginButton.disabled = false;
    loginButton.innerHTML = 'Log in <span>↗</span>';
  }
});

// Forgot password
if (forgotPasswordLink) {
  forgotPasswordLink.addEventListener("click", async (event) => {
    event.preventDefault();

    const email = document.getElementById("email").value.trim();

    if (!email) {
      showLoginMessage(
        "Please enter your email address first, then click Forgot password.",
        true
      );
      document.getElementById("email").focus();
      return;
    }

    forgotPasswordLink.style.pointerEvents = "none";
    showLoginMessage("Sending password reset email...");

    try {
      const resetUrl = new URL(
        "reset-password.html",
        window.location.href
      ).href;

      const { error } =
        await supabaseClient.auth.resetPasswordForEmail(email, {
          redirectTo: resetUrl
        });

      if (error) throw error;

      showLoginMessage(
        "If an account exists for this email, a password reset link has been sent. Please check your inbox."
      );
    } catch (error) {
      console.error("Password reset error:", error);
      showLoginMessage(
        "Could not send the reset email. Please try again and check your Supabase URL settings.",
        true
      );
    } finally {
      forgotPasswordLink.style.pointerEvents = "";
    }
  });
}
