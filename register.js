
const registerForm = document.getElementById("registerForm");
const registerMessage = document.getElementById("registerMessage");
const registerButton = document.getElementById("registerButton");

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const fullName = document.getElementById("fullName").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!fullName) {
    registerMessage.textContent = "Please enter your name.";
    return;
  }

  registerButton.disabled = true;
  registerButton.textContent = "Creating account...";
  registerMessage.textContent = "";

  try {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName }
      }
    });

    if (error) throw error;

    if (data.session) {
      registerMessage.textContent = "Account created! Opening your dashboard...";
      window.location.href = "index.html";
    } else {
      registerMessage.textContent =
        "Account created! Check your email for a confirmation link, then log in.";
    }
  } catch (error) {
    registerMessage.textContent = error.message || "Registration failed. Please try again.";
  } finally {
    registerButton.disabled = false;
    registerButton.innerHTML = 'Create account <span>↗</span>';
  }
});
