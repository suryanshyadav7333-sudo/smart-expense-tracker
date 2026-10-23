
const STORAGE_KEY = "bloom_expenses_v1";
const BUDGET_KEY = "bloom_budget_v1";
const DEFAULT_BUDGET = 20000;

const categories = {
  Food:          { emoji: "🍜", color: "#f3a16e", bg: "#fff0e4" },
  Transport:     { emoji: "🚗", color: "#83addb", bg: "#eaf3ff" },
  Shopping:      { emoji: "🛍️", color: "#d99abb", bg: "#fbeaf3" },
  Bills:         { emoji: "💡", color: "#e4bf61", bg: "#fff5d9" },
  Health:        { emoji: "🌿", color: "#75bd94", bg: "#e6f5e9" },
  Education:     { emoji: "📚", color: "#9d8be5", bg: "#f0ebff" },
  Entertainment: { emoji: "🎬", color: "#e68b82", bg: "#ffedeb" },
  Other:         { emoji: "✳️", color: "#a3a2ac", bg: "#f0eff2" }
};

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});

const $ = selector => document.querySelector(selector);

let expenses = [];
let monthlyBudget = DEFAULT_BUDGET;
let selectedMonth = localDateString().slice(0, 7);
let expenseChart = null;
let spendingTrendChart = null;
let currentUser = null;
let isSaving = false;
let isDeleting = false;
let isInitialized = false;
let isBudgetSaving = false;
let editingExpenseId = null;

document.querySelector("#cancelEditBtn")?.remove();

// Keep the existing browser budget as a one-time migration source.
// After loading the cloud budget, remove this legacy value.
function readLegacyBudget() {
  try {
    const value = Number(localStorage.getItem(BUDGET_KEY));

    return localStorage.getItem(BUDGET_KEY) !== null &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 100000000
      ? value
      : DEFAULT_BUDGET;
  } catch {
    return DEFAULT_BUDGET;
  }
}

function clearLegacyBudget() {
  try {
    localStorage.removeItem(BUDGET_KEY);
  } catch (error) {
    console.warn("Could not clear the old local budget:", error);
  }
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isThisMonth(dateString) {
  const date = new Date(`${dateString}T12:00:00`);
  const now = new Date();

  return Number.isFinite(date.getTime()) &&
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth();
}

function showMessage(message, isError = false) {
  const element = $("#formMessage");

  if (!element) return;

  element.textContent = message;
  element.style.color = isError ? "#c45142" : "#248e69";
}

function getMonthlyExpenses() {
  return expenses.filter(item =>
    item.date.slice(0, 7) === selectedMonth
  );
}

function getCategoryTotals(monthlyExpenses) {
  const totals = {};

  monthlyExpenses.forEach(item => {
    totals[item.category] =
      (totals[item.category] || 0) + item.amount;
  });

  return totals;
}

async function generateRecurringExpenses() {
  const { data: rules, error } = await supabaseClient
    .from("recurring_expenses")
    .select("id, title, amount, category, day_of_month, last_generated_month")
    .eq("user_id", currentUser.id)
    .eq("is_active", true);

  if (error) throw error;

  const now = new Date();
  const currentMonth = localDateString().slice(0, 7);

  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  for (const rule of rules || []) {
    if (rule.last_generated_month === currentMonth) {
      continue;
    }

    const day = Math.min(Number(rule.day_of_month), daysInMonth);

    const expenseDate =
      `${currentMonth}-${String(day).padStart(2, "0")}`;

    const { error: insertError } = await supabaseClient
      .from("expenses")
      .upsert({
        user_id: currentUser.id,
        title: rule.title,
        amount: Number(rule.amount),
        category: rule.category,
        expense_date: expenseDate,
        recurring_expense_id: rule.id
      }, {
        onConflict: "recurring_expense_id,expense_date",
        ignoreDuplicates: true
      });

    if (insertError) {
      throw insertError;
    }

    const { error: updateError } = await supabaseClient
      .from("recurring_expenses")
      .update({ last_generated_month: currentMonth })
      .eq("id", rule.id)
      .eq("user_id", currentUser.id);

    if (updateError) {
      throw updateError;
    }
  }
}

// Load only the current user's expenses from Supabase.
async function loadExpenses() {
  const { data, error } = await supabaseClient
    .from("expenses")
    .select("id, title, amount, category, expense_date, created_at")
    .eq("user_id", currentUser.id)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;

  expenses = (data || [])
    .filter(item => Object.hasOwn(categories, item.category))
    .map(item => ({
      id: String(item.id),
      title: item.title,
      amount: Number(item.amount),
      category: item.category,
      date: item.expense_date
    }))
    .filter(item =>
      typeof item.title === "string" &&
      item.title.length > 0 &&
      Number.isFinite(item.amount) &&
      item.amount > 0 &&
      typeof item.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    );
}

// Load the current user's budget.
// Migrate the old local budget only if this user has no cloud budget yet.
async function loadBudget() {
  const { data, error } = await supabaseClient
    .from("budgets")
    .select("monthly_budget")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    monthlyBudget = Number(data.monthly_budget);
    clearLegacyBudget();
    return;
  }

  const initialBudget = readLegacyBudget();

  const { data: inserted, error: insertError } =
    await supabaseClient
      .from("budgets")
      .insert({
        user_id: currentUser.id,
        monthly_budget: initialBudget
      })
      .select("monthly_budget")
      .single();

  if (insertError) throw insertError;

  monthlyBudget = Number(inserted.monthly_budget);
  clearLegacyBudget();
}

// Save the budget to the user's cloud account.
async function saveBudgetToSupabase(value) {
  const { error } = await supabaseClient
    .from("budgets")
    .upsert({
      user_id: currentUser.id,
      monthly_budget: value,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "user_id"
    });

  if (error) throw error;
}

function renderSummary() {
  const monthlyExpenses = getMonthlyExpenses();
  const total = monthlyExpenses.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  const remaining = monthlyBudget - total;

  $("#totalSpent").textContent = money.format(total);
  $("#budgetDisplay").textContent = money.format(monthlyBudget);
  $("#remaining").textContent = money.format(remaining);

  $("#remaining").style.color =
    remaining < 0 ? "#bc503e" : "#282a36";

  $("#remainingNote").textContent = remaining < 0
    ? `Over budget by ${money.format(Math.abs(remaining))}`
    : "Available from your budget";

  const percent = monthlyBudget > 0
    ? (total / monthlyBudget) * 100
    : total > 0 ? 100 : 0;

  $("#budgetProgress").style.width =
    `${Math.min(percent, 100)}%`;

  $("#budgetProgress").style.background =
    percent > 100 ? "#c45142" : "#df8a5b";

  $("#budgetProgress").parentElement.setAttribute(
    "aria-label",
    `Budget used: ${percent.toFixed(1)} percent`
  );
}

function renderChart() {
  const totals = getCategoryTotals(getMonthlyExpenses());

  const usedCategories = Object.keys(categories).filter(
    category => totals[category] > 0
  );

  const canvas = $("#expenseChart");
  const emptyState = $("#emptyChart");

  if (expenseChart) {
    expenseChart.destroy();
    expenseChart = null;
  }

  if (!usedCategories.length) {
    canvas.style.display = "none";
    emptyState.style.display = "flex";
    $("#categoryLegend").replaceChildren();
    return;
  }

  canvas.style.display = "block";
  emptyState.style.display = "none";

  expenseChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: usedCategories,
      datasets: [{
        data: usedCategories.map(category => totals[category]),
        backgroundColor: usedCategories.map(
          category => categories[category].color
        ),
        borderWidth: 4,
        borderColor: "#fffdf9",
        hoverOffset: 7,
        spacing: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: context =>
              `${context.label}: ${money.format(context.raw)}`
          }
        }
      }
    }
  });

  const legend = $("#categoryLegend");
  legend.replaceChildren();

  usedCategories.forEach(category => {
    const item = document.createElement("div");
    item.className = "legend-item";

    const dot = document.createElement("span");
    dot.className = "legend-dot";
    dot.style.background = categories[category].color;

    const name = document.createElement("span");
    name.className = "legend-name";
    name.textContent = category;

    const value = document.createElement("strong");
    value.className = "legend-value";
    value.textContent = money.format(totals[category]);

    item.append(dot, name, value);
    legend.append(item);
  });
}

function renderTransactions() {
  const list = $("#transactionList");
  const emptyState = $("#emptyTransactions");
  const selectedCategory = $("#filterCategory").value;


const searchTerm = $("#expenseSearch").value
  .trim()
  .toLowerCase();

const filtered = expenses
  .filter(item =>
    item.date.slice(0, 7) === selectedMonth &&
    (
      selectedCategory === "All" ||
      item.category === selectedCategory
    ) &&
    (
      item.title.toLowerCase().includes(searchTerm) ||
      item.category.toLowerCase().includes(searchTerm)
    )
  )
  .sort((a, b) =>
      b.date.localeCompare(a.date) ||
      Number(b.id) - Number(a.id)
    );

  list.replaceChildren();
  emptyState.style.display = filtered.length ? "none" : "block";



  
if (!filtered.length) {
  const heading = emptyState.querySelector("h3");
  const message = emptyState.querySelector("p");

  heading.textContent = getMonthlyExpenses().length
    ? "No matching expenses"
    : "A fresh start!";

  message.textContent = getMonthlyExpenses().length
    ? "Try another category to see your transactions."
    : "Your expenses will appear here when you add them.";

  return;
}

  filtered.forEach(item => {
    const info = categories[item.category];

    const row = document.createElement("div");
    row.className = "transaction-row";

    const icon = document.createElement("div");
    icon.className = "transaction-icon";
    icon.style.background = info.bg;
    icon.textContent = info.emoji;

    const details = document.createElement("div");
    details.className = "transaction-details";

    const title = document.createElement("strong");
    title.textContent = item.title;

    const meta = document.createElement("small");
    meta.textContent =
      `${item.category} · ${formatDate(item.date)}`;

    details.append(title, meta);

    const right = document.createElement("div");
    right.className = "transaction-right";

    const amount = document.createElement("strong");
    amount.className = "transaction-amount";
    amount.textContent = `− ${money.format(item.amount)}`;

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-btn";
    deleteButton.textContent = "×";
    deleteButton.setAttribute(
      "aria-label",
      `Delete ${item.title}`
    );
    deleteButton.title = "Delete expense";
    deleteButton.disabled = isDeleting;
    deleteButton.addEventListener(
      "click",
      () => deleteExpense(item.id)
    );

const editButton = document.createElement("button");
editButton.type = "button";
editButton.className = "edit-btn";
editButton.textContent = "Edit";
editButton.setAttribute(
  "aria-label",
  `Edit ${item.title}`
);
editButton.title = "Edit expense";
editButton.disabled = isDeleting;
editButton.addEventListener(
  "click",
  () => startEditingExpense(item.id)
);
right.append(amount, editButton, deleteButton);
    row.append(icon, details, right);
    list.append(row);
  });
}

function formatDate(dateString) {
  const date = new Date(`${dateString}T12:00:00`);

  if (!Number.isFinite(date.getTime())) return dateString;

  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}



function renderAll() {
  renderSummary();
  renderChart();
  renderTransactions();
  renderSmartInsights();
  renderSpendingTrend();
    renderWellnessScore();
}


function renderSpendingTrend() {
  const monthlyExpenses = getMonthlyExpenses();
  const canvas = $("#spendingTrendChart");
  const emptyMessage = $("#emptyTrend");

  if (spendingTrendChart) {
    spendingTrendChart.destroy();
    spendingTrendChart = null;
  }

  if (!monthlyExpenses.length) {
    canvas.style.display = "none";
    emptyMessage.hidden = false;
    return;
  }

  canvas.style.display = "block";
  emptyMessage.hidden = true;

  // Prepare a total for every day of the selected month.
  const [year, month] = selectedMonth.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyTotals = Array(daysInMonth).fill(0);

  monthlyExpenses.forEach(item => {
    const day = Number(item.date.slice(8, 10));
    if (day >= 1 && day <= daysInMonth) {
      dailyTotals[day - 1] += item.amount;
    }

  });

  spendingTrendChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: dailyTotals.map((_, index) => String(index + 1)),
      datasets: [{
        label: "Daily spending",
        data: dailyTotals,
        borderColor: "#d98b62",
        backgroundColor: "rgba(217, 139, 98, 0.15)",
        fill: true,
        tension: 0.35,
        borderWidth: 3,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: "#d98b62"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index"
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          callbacks: {
            label: context =>
              `Spent: ${money.format(context.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "Day of month"
          },
          grid: {
            display: false
          }
        },
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: "Amount (₹)"
          },
          ticks: {
            callback: value =>
              "₹" + Number(value).toLocaleString("en-IN")
          }
        }
      }
    }
  });
}


function renderWellnessScore() {
  const monthlyExpenses = getMonthlyExpenses();

  const total = monthlyExpenses.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  const scoreElement = $("#wellnessScore");
  const titleElement = $("#wellnessTitle");
  const messageElement = $("#wellnessMessage");
  const progressElement = $("#wellnessProgress");
  const circleElement = $("#wellnessCircle");

  // No expenses recorded for the selected month
  if (monthlyExpenses.length === 0) {
    scoreElement.textContent = "--";
    titleElement.textContent = "Start tracking";
    messageElement.textContent =
      "Add expenses for this month to see your budget snapshot.";
    progressElement.style.width = "0%";
    return;
  }

  // A positive budget is required for the calculation
  if (monthlyBudget <= 0) {
    scoreElement.textContent = "--";
    titleElement.textContent = "Set a monthly budget";
    messageElement.textContent =
      "Choose a budget above ₹0 to calculate your score.";
    progressElement.style.width = "0%";
    return;
  }

  const percentage = (total / monthlyBudget) * 100;

  // This is a simple budget-based indicator, not a full
  // assessment of someone's overall financial health.
  const score = Math.max(
    0,
    Math.min(100, Math.round(100 - percentage))
  );

  scoreElement.textContent = score;
  progressElement.style.width =
    `${Math.min(100, percentage)}%`;

  if (percentage >= 100) {
    titleElement.textContent = "Over budget";
    messageElement.textContent =
      `You've exceeded your budget by ${money.format(total - monthlyBudget)}. Review optional expenses.`;

    circleElement.style.background = "#fde8e7";
    circleElement.style.color = "#c74640";
    progressElement.style.background = "#e36b64";

  } else if (percentage >= 80) {
    titleElement.textContent = "Budget nearly used";
    messageElement.textContent =
      `${Math.round(percentage)}% used. ${money.format(monthlyBudget - total)} remaining.`;

    circleElement.style.background = "#fff0d9";
    circleElement.style.color = "#b87519";
    progressElement.style.background = "#e9ad52";

  } else if (percentage >= 50) {
    titleElement.textContent = "Keep an eye on spending";
    messageElement.textContent =
      `${Math.round(percentage)}% of your budget used. ${money.format(monthlyBudget - total)} remaining.`;

    circleElement.style.background = "#fff0d9";
    circleElement.style.color = "#b87519";
    progressElement.style.background = "#e9ad52";

  } else {
    titleElement.textContent = "You're within budget";
    messageElement.textContent =
      `${money.format(monthlyBudget - total)} remaining. Keep tracking your expenses.`;

    circleElement.style.background = "#e6f5e9";
    circleElement.style.color = "#27845b";
    progressElement.style.background = "#75bd94";
  }
}



function renderSmartInsights() {
  const monthlyExpenses = getMonthlyExpenses();

  const total = monthlyExpenses.reduce(
    (sum, item) => sum + item.amount,
    0
  );

  // Find the category with the highest spending.
  const categoryTotals = getCategoryTotals(monthlyExpenses);
  const categoryEntries = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1]);

  const categoryHeading = $("#insightCategory");
  const categoryDetail = $("#insightCategoryDetail");

  if (categoryEntries.length > 0) {
    const [topCategory, topAmount] = categoryEntries[0];
    const percentage = total > 0
      ? Math.round((topAmount / total) * 100)
      : 0;

    categoryHeading.textContent =
      `${categories[topCategory].emoji} ${topCategory}`;

    categoryDetail.textContent =
      `${money.format(topAmount)} spent — ${percentage}% of your selected month's expenses.`;
  } else {
    categoryHeading.textContent = "No expenses yet";
    categoryDetail.textContent =
      "Add an expense to discover your biggest spending category.";
  }

  // Calculate budget usage.
  const budgetHeading = $("#insightBudget");
  const budgetDetail = $("#insightBudgetDetail");

  if (monthlyBudget === 0) {
    budgetHeading.textContent = total > 0
      ? "No budget set"
      : "Budget is ₹0";

    budgetDetail.textContent = total > 0
      ? `You've spent ${money.format(total)} without a positive budget limit.`
      : "Set a monthly budget to track your spending.";
  } else {
    const percentage = Math.round(
      (total / monthlyBudget) * 100
    );

    budgetHeading.textContent = `${percentage}% used`;

    if (total > monthlyBudget) {
      budgetDetail.textContent =
        `You've exceeded your budget by ${money.format(total - monthlyBudget)}.`;
    } else {
      budgetDetail.textContent =
        `${money.format(monthlyBudget - total)} remaining from your budget.`;
    }
  }

  // Generate a spending tip based on actual data.
  const tipTitle = $("#insightTipTitle");
  const tip = $("#insightTip");

  if (monthlyExpenses.length === 0) {
    tipTitle.textContent = "Start tracking";
    tip.textContent =
      "Add your first expense for this month to receive a useful spending tip.";
  } else if (total > monthlyBudget && monthlyBudget > 0) {
    tipTitle.textContent = "Review your spending";
    tip.textContent =
      "Your expenses are above your budget. Review optional purchases and consider adjusting your spending plan.";
  } else if (
    monthlyBudget > 0 &&
    total / monthlyBudget >= 0.8
  ) {
    tipTitle.textContent = "You're nearing your limit";
    tip.textContent =
      "You've used at least 80% of your budget. Check upcoming expenses before making extra purchases.";
  } else if (categoryEntries.length > 0) {
    tipTitle.textContent = "Know your biggest expense";
    tip.textContent =
      `${categoryEntries[0][0]} is your top spending category this month. Review it to see whether you can save.`;
  } else {
    tipTitle.textContent = "Keep it up";
    tip.textContent =
      "Keep recording expenses to understand your spending habits.";
  }
}



 // Add or edit an expense in Supabase.
$("#expenseForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (isSaving || !currentUser) return;

  const title = $("#expenseTitle").value.trim();
  const amount = Number($("#expenseAmount").value);
  const category = $("#expenseCategory").value;
  const date = $("#expenseDate").value;
  const today = localDateString();

  // Validate expense name
  if (!title) {
    showMessage("Please enter an expense name.", true);
    return;
  }

  // Validate amount
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 100000000
  ) {
    showMessage("Enter a valid amount greater than zero.", true);
    return;
  }

  // Validate category
  if (!Object.hasOwn(categories, category)) {
    showMessage("Please select a valid category.", true);
    return;
  }

  // Validate date
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    showMessage("Please select a valid date.", true);
    return;
  }

  const parsedDate = new Date(`${date}T12:00:00`);

  if (
    !Number.isFinite(parsedDate.getTime()) ||
    localDateString(parsedDate) !== date ||
    date > today
  ) {
    showMessage("Please choose a valid date that is not in the future.", true);
    return;
  }

  isSaving = true;

  const submitButton = $("#expenseForm").querySelector(
    'button[type="submit"]'
  );

  if (submitButton) submitButton.disabled = true;

  showMessage(
    editingExpenseId !== null
      ? "Updating your expense..."
      : "Saving your expense..."
  );

  try {
    // EDIT EXISTING EXPENSE
    if (editingExpenseId !== null) {
      const expenseId = editingExpenseId;

      const { data, error } = await supabaseClient
        .from("expenses")
        .update({
          title,
          amount: Math.round(amount * 100) / 100,
          category,
          expense_date: date
        })
        .eq("id", expenseId)
        .eq("user_id", currentUser.id)
        .select("id, title, amount, category, expense_date")
        .single();

      if (error) throw error;

      expenses = expenses.map(item =>
        item.id === expenseId
          ? {
              id: String(data.id),
              title: data.title,
              amount: Number(data.amount),
              category: data.category,
              date: data.expense_date
            }
          : item
      );

      editingExpenseId = null;

      $("#expenseForm").reset();
      $("#expenseDate").value = today;
      $("#expenseCategory").value = "Food";

      if (submitButton) {
        submitButton.textContent = "Add Expense";
      }

      renderAll();
      showMessage("✓ Expense updated successfully!");

    } else {


const recurringCheckbox = $("#isRecurring");
const shouldRepeatMonthly = recurringCheckbox.checked;


      // ADD NEW EXPENSE
      const { data, error } = await supabaseClient
        .from("expenses")
        .insert({
          user_id: currentUser.id,
          title,
          amount: Math.round(amount * 100) / 100,
          category,
          expense_date: date
        })
        .select("id, title, amount, category, expense_date")
        .single();

      if (error) throw error;

      expenses.push({
        id: String(data.id),
        title: data.title,
        amount: Number(data.amount),
        category: data.category,
        date: data.expense_date
      });


if (shouldRepeatMonthly) {
  const expenseMonth = date.slice(0, 7);

  // Create the recurring rule and mark the initial month
  // as already generated.
  const { data: recurringRule, error: recurringError } =
    await supabaseClient
      .from("recurring_expenses")
      .insert({
        user_id: currentUser.id,
        title,
        amount: Math.round(amount * 100) / 100,
        category,
        day_of_month: Number(date.slice(8, 10)),
        is_active: true,
        last_generated_month: expenseMonth
      })
      .select("id")
      .single();

  if (recurringError) {
    console.error(
      "Could not save recurring setting:",
      recurringError
    );

    showMessage(
      "Expense saved, but the recurring setting could not be saved.",
      true
    );
  } else {
    // Link the expense already saved to its recurring rule.
    const { error: linkError } = await supabaseClient
      .from("expenses")
      .update({
        recurring_expense_id: recurringRule.id
      })
      .eq("id", data.id)
      .eq("user_id", currentUser.id);

    if (linkError) {
      console.error(
        "Could not link recurring expense:",
        linkError
      );

      showMessage(
        "Expense saved, but its recurring link could not be saved.",
        true
      );
    }
  }
}

      $("#expenseForm").reset();
      $("#expenseDate").value = today;
      $("#expenseCategory").value = "Food";

      renderAll();
      showMessage("✓ Expense saved to your account!");
    }

    $("#transactions").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

  } catch (error) {
    console.error("Save expense error:", error);

    showMessage(
      `Could not save expense: ${error.message}`,
      true
    );

  } finally {
    isSaving = false;

    if (submitButton) {
      submitButton.disabled = false;
    }
  }
});

// Delete an expense from Supabase.
async function deleteExpense(id) {
  if (isDeleting || !currentUser) return;

  const item = expenses.find(expense => expense.id === id);
  if (!item) return;

  if (!confirm(`Delete "${item.title}"?`)) return;

  isDeleting = true;
  renderTransactions();

  try {
    const { error } = await supabaseClient
      .from("expenses")
      .delete()
      .eq("id", Number(id))
      .eq("user_id", currentUser.id);

    if (error) throw error;

    expenses = expenses.filter(expense => expense.id !== id);

    renderAll();
    showMessage("Expense deleted successfully.");
  } catch (error) {
    console.error("Delete expense error:", error);
    showMessage(
      `Could not delete expense: ${error.message}`,
      true
    );
  } finally {
    isDeleting = false;
    renderTransactions();
  }
}

$("#filterCategory").addEventListener(
  "change",
  renderTransactions
);
$("#expenseSearch").addEventListener("input", renderTransactions);
$("#exportCsvBtn").addEventListener(
  "click",
  exportExpensesToCSV
);

$("#monthFilter").addEventListener("change", event => {
  const value = event.target.value;

  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    event.target.value = selectedMonth;
    return;
  }

  selectedMonth = value;
  renderAll();
});

$("#openForm").addEventListener("click", () => {
  $("#expenseTitle").focus();

  $("#expenseForm").scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
});

const budgetModal = $("#budgetModal");

$("#editBudget").addEventListener("click", () => {
  $("#budgetInput").value = monthlyBudget;
  budgetModal.hidden = false;
  $("#budgetInput").focus();
});

$("#closeBudget").addEventListener("click", () => {
  budgetModal.hidden = true;
});

budgetModal.addEventListener("click", event => {
  if (event.target === budgetModal) {
    budgetModal.hidden = true;
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    budgetModal.hidden = true;
  }
});

// Save the budget to Supabase.
$("#budgetForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (isBudgetSaving || !currentUser) return;

  const value = Number($("#budgetInput").value);

  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100000000
  ) {
    showMessage("Enter a valid budget amount.", true);
    return;
  }

  const roundedValue = Math.round(value * 100) / 100;
  const saveButton = $("#budgetForm").querySelector(
    'button[type="submit"]'
  );

  isBudgetSaving = true;
  if (saveButton) saveButton.disabled = true;

  try {
    await saveBudgetToSupabase(roundedValue);

    monthlyBudget = roundedValue;
    renderSummary();
    budgetModal.hidden = true;
    showMessage("✓ Budget saved to your account!");
  } catch (error) {
    console.error("Budget save error:", error);
    showMessage(
      `Could not save budget: ${error.message}`,
      true
    );
  } finally {
    isBudgetSaving = false;
    if (saveButton) saveButton.disabled = false;
  }
});

async function initializeApp() {
  const now = new Date();

  $("#today").textContent = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });

  $("#expenseDate").value = localDateString();
  $("#expenseDate").max = localDateString();
  $("#monthFilter").value = selectedMonth;

  try {
    const { data, error } = await supabaseClient.auth.getUser();

    if (error || !data.user) {
      window.location.replace("login.html");
      return;
    }

    currentUser = data.user;

   
await loadBudget();

await generateRecurringExpenses();

await loadExpenses();


    renderAll();
    showMessage("Your expenses and budget are synced!");
    isInitialized = true;
  } catch (error) {
    console.error("Dashboard initialization error:", error);
    showMessage(
      `Could not load your account data: ${error.message}`,
      true
    );
  }
}

initializeApp();

// Logout.
const logoutButton = document.getElementById("logoutButton");

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;

    try {
      const { error } = await supabaseClient.auth.signOut();

      if (error) throw error;

      window.location.replace("login.html");
    } catch (error) {
      console.error("Logout error:", error);
      alert("Logout failed: " + error.message);
      logoutButton.disabled = false;
    }
  });
}

function exportExpensesToCSV() {
  // Export expenses for the currently selected month
  const monthlyExpenses = getMonthlyExpenses()
    .filter(item =>
      $("#filterCategory").value === "All" ||
      item.category === $("#filterCategory").value
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  if (monthlyExpenses.length === 0) {
    showMessage(
      "No expenses found for the selected month and category.",
      "error"
    );
    return;
  }

  const headers = [
    "Date",
    "Expense",
    "Category",
    "Amount (INR)"
  ];

  // Escape CSV values safely, including commas and quotation marks
  const escapeCSV = value =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const rows = monthlyExpenses.map(item => [
    item.date,
    item.title,
    item.category,
    Number(item.amount).toFixed(2)
  ]);

  const csvContent = [
    headers,
    ...rows
  ]
    .map(row => row.map(escapeCSV).join(","))
    .join("\r\n");

  // Add a BOM to improve compatibility with Excel
  const blob = new Blob(
    ["\uFEFF" + csvContent],
    { type: "text/csv;charset=utf-8;" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `bloom-expenses-${selectedMonth}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);

  showMessage("Your CSV file has been downloaded.", "success");
}

function startEditingExpense(id) {
  const expense = expenses.find(item => item.id === String(id));

  if (!expense) {
    alert("Expense not found.");
    return;
  }

  // Remember which expense is being edited
  editingExpenseId = expense.id;

  // Fill the existing expense form
  $("#expenseTitle").value = expense.title;
  $("#expenseAmount").value = expense.amount;
  $("#expenseCategory").value = expense.category;
  $("#expenseDate").value = expense.date;

  // Change the submit button text
  const submitButton = $("#expenseForm button[type='submit']");
  submitButton.textContent = "Save Changes";
   

let cancelButton = document.querySelector("#cancelEditBtn");

if (!cancelButton) {
  cancelButton = document.createElement("button");
  cancelButton.id = "cancelEditBtn";
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel Edit";
  cancelButton.className = "cancel-edit-btn";

  submitButton.insertAdjacentElement("afterend", cancelButton);

  cancelButton.addEventListener("click", () => {
    editingExpenseId = null;

    $("#expenseForm").reset();
    $("#expenseDate").value = localDateString();
    $("#expenseCategory").value = "Food";

    submitButton.textContent = "Add Expense";
    cancelButton.remove();

    showMessage("Editing cancelled.");
  });
}


  // Move the user to the expense form
  $("#expenseForm").scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  showMessage("You are editing an expense. Make your changes.");
}

