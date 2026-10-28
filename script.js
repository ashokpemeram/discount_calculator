// Keep money in paise (BigInt) so even long bills add without floating-point drift.
const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const discountFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const SNACK_DISCOUNTS = Object.freeze({ veg: 15, nonveg: 10 });

function rupeesToPaise(value) {
  const rawValue = String(value ?? "").trim();
  if (!rawValue) return 0n;

  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 0n;

  const match = rawValue.match(/^\+?(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match) return 0n;

  const wholeDigits = match[1] || "0";
  const fractionDigits = match[2] || "";
  const significantDigits = `${wholeDigits}${fractionDigits}`.replace(/^0+/, "") || "0";
  if (significantDigits === "0") return 0n;

  const exponent = Number(match[3] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) return 0n;
  const shift = 2 - fractionDigits.length + exponent;
  const amount = BigInt(significantDigits);

  if (shift >= 0) return amount * 10n ** BigInt(shift);

  const divisor = 10n ** BigInt(-shift);
  const quotient = amount / divisor;
  const remainder = amount % divisor;
  return quotient + (remainder * 2n >= divisor ? 1n : 0n);
}

function calculateLineItem(priceValue, snackType) {
  const originalPaise = rupeesToPaise(priceValue);
  const discountPercent = Object.hasOwn(SNACK_DISCOUNTS, snackType)
    ? SNACK_DISCOUNTS[snackType]
    : 0;
  const discountBasisPoints = BigInt(Math.round(discountPercent * 100));
  const discountPaise = (originalPaise * discountBasisPoints + 5000n) / 10000n;

  return {
    originalPaise,
    discountPercent,
    discountPaise,
    finalPaise: originalPaise - discountPaise,
  };
}

function calculateBill(items) {
  return items.reduce(
    (totals, item) => {
      const line = calculateLineItem(item.price, item.type);
      totals.originalPaise += line.originalPaise;
      totals.discountPaise += line.discountPaise;
      totals.grandPaise += line.finalPaise;
      return totals;
    },
    { originalPaise: 0n, discountPaise: 0n, grandPaise: 0n }
  );
}

function calculateComplimentaryRewards(originalPaise, bunChoice = "") {
  const gulabJamun = originalPaise > 23000n;
  const bunUnlocked = originalPaise > 25000n;
  const selectedBun = bunUnlocked && (bunChoice === "kova" || bunChoice === "muska")
    ? bunChoice
    : "";
  return { gulabJamun, bunUnlocked, selectedBun };
}

function formatMoney(paise) {
  const wholeRupees = paise / 100n;
  const remainingPaise = String(paise % 100n).padStart(2, "0");
  return `${currencyFormatter.format(wholeRupees)}.${remainingPaise}`;
}

// These pure helpers can be checked with Node; browsers simply ignore this export.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    rupeesToPaise,
    calculateLineItem,
    calculateBill,
    calculateComplimentaryRewards,
    formatMoney,
  };
}

if (typeof document !== "undefined") {
  (() => {
    const itemsBody = document.querySelector("#items-body");
    const rowTemplate = document.querySelector("#item-row-template");
    const itemCount = document.querySelector("#item-count");
    const announcement = document.querySelector("#form-announcement");
    const bunChoice = document.querySelector("#bun-choice");
    const rewardElements = {
      gulabCard: document.querySelector("#reward-gulab"),
      gulabMessage: document.querySelector("#gulab-message"),
      gulabStatus: document.querySelector("#gulab-status"),
      bunCard: document.querySelector("#reward-bun"),
      bunMessage: document.querySelector("#bun-message"),
      bunStatus: document.querySelector("#bun-status"),
      bunChoiceWrap: document.querySelector("#bun-choice-wrap"),
      printSummary: document.querySelector("#gift-print-summary"),
    };
    const totalElements = {
      original: document.querySelector("#original-total"),
      discount: document.querySelector("#discount-total"),
      grand: document.querySelector("#grand-total"),
    };

    function addItemRow({ name = "", price = "" } = {}) {
      const row = rowTemplate.content.firstElementChild.cloneNode(true);
      const nameInput = row.querySelector(".item-name");
      const typeInput = row.querySelector(".item-type");
      const priceInput = row.querySelector(".item-price");

      nameInput.value = name;
      priceInput.value = price;
      row.querySelector(".remove-item").addEventListener("click", () => {
        const itemName = nameInput.value.trim() || "Item";
        row.remove();
        updateBill();
        announcement.textContent = `${itemName} removed.`;
      });

      nameInput.addEventListener("input", updateBill);
      typeInput.addEventListener("change", updateBill);
      priceInput.addEventListener("input", handleNumericInput);
      priceInput.addEventListener("change", commitNumericInput);

      itemsBody.append(row);
      updateBill();
      return row;
    }

    function getValidationMessage(input) {
      if (input.validity.badInput) return "Enter a valid number.";
      if (input.value.trim() === "") return "";

      const value = Number(input.value);
      if (!Number.isFinite(value)) return "Enter a valid number.";
      if (value < 0) return "Value cannot be negative.";
      return "";
    }

    function showValidation(input, message) {
      const error = input.closest("td").querySelector(".validation-error");
      input.setCustomValidity(message);
      input.setAttribute("aria-invalid", String(Boolean(message)));
      error.textContent = message;
      error.hidden = !message;
    }

    function handleNumericInput(event) {
      const input = event.currentTarget;
      showValidation(input, getValidationMessage(input));
      updateBill();
    }

    // Correct out-of-range values when the cashier leaves the field. Empty stays empty.
    function commitNumericInput(event) {
      const input = event.currentTarget;
      if (input.validity.badInput) {
        input.value = "";
      } else if (input.value.trim() !== "" && Number(input.value) < 0) {
        input.value = "0";
      }
      showValidation(input, "");
      updateBill();
    }

    function setPrintValues(row, snackType, pricePaise, discountPercent, discountPaise, finalPaise) {
      const name = row.querySelector(".item-name").value.trim();
      const hasSnackType = Object.hasOwn(SNACK_DISCOUNTS, snackType);
      row.classList.toggle("has-discount", hasSnackType);
      row.querySelector(".print-name").textContent = name || "—";
      row.querySelector(".print-type").textContent = snackType === "veg" ? "Veg" : snackType === "nonveg" ? "Non-Veg" : "—";
      row.querySelector(".print-price").textContent = formatMoney(pricePaise);
      row.querySelector(".discount-rate").textContent = hasSnackType ? `${discountFormatter.format(discountPercent)}%` : "—";
      row.querySelector(".print-discount").textContent = hasSnackType ? `${discountFormatter.format(discountPercent)}%` : "—";
      row.querySelector(".print-amount").textContent = formatMoney(discountPaise);
      row.querySelector(".print-final").textContent = formatMoney(finalPaise);
    }

    function updateComplimentaryRewards(originalTotalPaise) {
      const rewards = calculateComplimentaryRewards(originalTotalPaise, bunChoice.value);
      rewardElements.gulabCard.classList.toggle("is-earned", rewards.gulabJamun);
      rewardElements.gulabStatus.textContent = rewards.gulabJamun ? "Unlocked" : "Locked";
      rewardElements.gulabMessage.textContent = rewards.gulabJamun
        ? "A sweet treat is on us!"
        : `Add ${formatMoney(23001n - originalTotalPaise)} more to unlock`;

      rewardElements.bunCard.classList.toggle("is-earned", rewards.bunUnlocked);
      rewardElements.bunStatus.hidden = rewards.bunUnlocked;
      rewardElements.bunChoiceWrap.hidden = !rewards.bunUnlocked;
      rewardElements.bunMessage.textContent = rewards.bunUnlocked
        ? "Choose one complimentary bun."
        : `Add ${formatMoney(25001n - originalTotalPaise)} more to unlock`;

      const complimentaryItems = [];
      if (rewards.gulabJamun) complimentaryItems.push("Gulab Jamun");
      if (rewards.bunUnlocked) {
        const bunName = rewards.selectedBun === "kova"
          ? "Kova Bun"
          : rewards.selectedBun === "muska"
            ? "Muska Bun"
            : "Kova Bun or Muska Bun (choice pending)";
        complimentaryItems.push(bunName);
      }
      rewardElements.printSummary.textContent = complimentaryItems.length
        ? `Complimentary: ${complimentaryItems.join(" + ")}`
        : "No complimentary treats unlocked.";
    }

    function updateBill() {
      let originalTotalPaise = 0n;
      let discountTotalPaise = 0n;
      let grandTotalPaise = 0n;

      for (const row of itemsBody.querySelectorAll(".item-row")) {
        const priceInput = row.querySelector(".item-price");
        const snackType = row.querySelector(".item-type").value;
        const { originalPaise, discountPercent, discountPaise, finalPaise } = calculateLineItem(
          priceInput.value,
          snackType
        );

        row.querySelector(".item-discount-amount").textContent = formatMoney(discountPaise);
        row.querySelector(".item-final-price").textContent = formatMoney(finalPaise);
        setPrintValues(row, snackType, originalPaise, discountPercent, discountPaise, finalPaise);

        originalTotalPaise += originalPaise;
        discountTotalPaise += discountPaise;
        grandTotalPaise += finalPaise;
      }

      totalElements.original.textContent = formatMoney(originalTotalPaise);
      totalElements.discount.textContent = formatMoney(discountTotalPaise);
      totalElements.grand.textContent = formatMoney(grandTotalPaise);
      updateComplimentaryRewards(originalTotalPaise);

      const count = itemsBody.querySelectorAll(".item-row").length;
      itemCount.textContent = `${count} ${count === 1 ? "item" : "items"}`;
    }

    function clearAllItems() {
      const hasEnteredData = bunChoice.value !== "" || [...itemsBody.querySelectorAll(".item-row")].some((row) =>
        [...row.querySelectorAll("input, select")].some((input) => input.value.trim() !== "")
      );

      if (hasEnteredData && !window.confirm("Clear all items and reset this bill?")) return;

      itemsBody.replaceChildren();
      bunChoice.value = "";
      addItemRow();
      announcement.textContent = "Bill cleared. A new empty item is ready.";
      itemsBody.querySelector(".item-name").focus();
    }

    document.querySelector("#add-item").addEventListener("click", () => {
      const row = addItemRow();
      row.querySelector(".item-name").focus();
      announcement.textContent = "Item added.";
    });
    document.querySelector("#clear-all").addEventListener("click", clearAllItems);
    document.querySelector("#print-bill").addEventListener("click", () => window.print());
    bunChoice.addEventListener("change", updateBill);

    const now = new Date();
    const printedDate = new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(now);
    document.querySelector("#bill-date").textContent = `Bill date: ${printedDate}`;
    document.querySelector("#print-date").textContent = `Bill date: ${printedDate}`;

    addItemRow();
  })();
}
