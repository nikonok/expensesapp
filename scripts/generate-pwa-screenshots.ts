import { chromium } from "@playwright/test";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, "../public/screenshots");
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
const BASE_URL = "http://localhost:4173";

const NOW = new Date().toISOString();
const TODAY = new Date();

function daysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const DEMO_ACCOUNTS = [
  {
    name: "Cash",
    type: "REGULAR",
    color: "var(--color-primary)",
    icon: "wallet",
    currency: "USD",
    description: "",
    balance: 2450,
    startingBalance: 3000,
    includeInTotal: true,
    isTrashed: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    name: "Savings",
    type: "SAVINGS",
    color: "var(--swatch-12)",
    icon: "piggy-bank",
    currency: "USD",
    description: "",
    balance: 12800,
    startingBalance: 10000,
    savingsGoal: 20000,
    includeInTotal: true,
    isTrashed: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    name: "Credit Card",
    type: "DEBT",
    color: "var(--swatch-1)",
    icon: "credit-card",
    currency: "USD",
    description: "",
    balance: -1230.5,
    startingBalance: -2000,
    interestRateYearly: 0.185,
    debtOriginalAmount: 2000,
    includeInTotal: true,
    isTrashed: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const DEMO_CATEGORIES = [
  {
    name: "Food",
    type: "EXPENSE",
    icon: "utensils",
    color: "var(--swatch-5)",
    displayOrder: 0,
    isTrashed: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    name: "Transport",
    type: "EXPENSE",
    icon: "car",
    color: "var(--swatch-16)",
    displayOrder: 1,
    isTrashed: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    name: "Housing",
    type: "EXPENSE",
    icon: "home",
    color: "var(--swatch-17)",
    displayOrder: 2,
    isTrashed: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    name: "Entertainment",
    type: "EXPENSE",
    icon: "gamepad-2",
    color: "var(--swatch-18)",
    displayOrder: 3,
    isTrashed: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    name: "Salary",
    type: "INCOME",
    icon: "briefcase",
    color: "var(--swatch-12)",
    displayOrder: 4,
    isTrashed: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    name: "Freelance",
    type: "INCOME",
    icon: "laptop",
    color: "var(--swatch-14)",
    displayOrder: 5,
    isTrashed: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const currentMonth = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, "0")}`;

const RAW_TRANSACTIONS = [
  {
    type: "EXPENSE",
    date: daysAgo(0),
    accountId: 1,
    categoryId: 1,
    amount: 28.5,
    note: "Lunch with team",
  },
  {
    type: "EXPENSE",
    date: daysAgo(0),
    accountId: 1,
    categoryId: 2,
    amount: 15.0,
    note: "Uber to office",
  },
  {
    type: "EXPENSE",
    date: daysAgo(1),
    accountId: 1,
    categoryId: 1,
    amount: 67.3,
    note: "Weekly groceries",
  },
  {
    type: "INCOME",
    date: daysAgo(1),
    accountId: 1,
    categoryId: 6,
    amount: 450.0,
    note: "Logo design project",
  },
  {
    type: "EXPENSE",
    date: daysAgo(2),
    accountId: 1,
    categoryId: 4,
    amount: 14.99,
    note: "Netflix subscription",
  },
  {
    type: "EXPENSE",
    date: daysAgo(2),
    accountId: 1,
    categoryId: 3,
    amount: 1200.0,
    note: "Rent payment",
  },
  {
    type: "INCOME",
    date: daysAgo(3),
    accountId: 1,
    categoryId: 5,
    amount: 3500.0,
    note: "Monthly salary",
  },
  {
    type: "EXPENSE",
    date: daysAgo(3),
    accountId: 1,
    categoryId: 1,
    amount: 42.0,
    note: "Dinner out",
  },
  {
    type: "EXPENSE",
    date: daysAgo(5),
    accountId: 1,
    categoryId: 2,
    amount: 55.0,
    note: "Gas station",
  },
  {
    type: "EXPENSE",
    date: daysAgo(5),
    accountId: 1,
    categoryId: 4,
    amount: 35.0,
    note: "Concert tickets",
  },
  {
    type: "EXPENSE",
    date: daysAgo(6),
    accountId: 1,
    categoryId: 1,
    amount: 23.8,
    note: "Coffee & pastry",
  },
  {
    type: "EXPENSE",
    date: daysAgo(6),
    accountId: 1,
    categoryId: 2,
    amount: 12.0,
    note: "Bus pass top-up",
  },
];

const DEMO_TRANSACTIONS = RAW_TRANSACTIONS.map((t, i) => ({
  ...t,
  timestamp: new Date(TODAY.getTime() - i * 60000).toISOString(),
  displayOrder: i,
  currency: "USD",
  amountMainCurrency: t.amount,
  exchangeRate: 1,
  transferGroupId: null,
  transferDirection: null,
  isTrashed: false,
  createdAt: NOW,
  updatedAt: NOW,
}));

const DEMO_BUDGETS = [
  {
    categoryId: 1,
    accountId: null,
    month: currentMonth,
    plannedAmount: 500,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    categoryId: 2,
    accountId: null,
    month: currentMonth,
    plannedAmount: 200,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    categoryId: 4,
    accountId: null,
    month: currentMonth,
    plannedAmount: 150,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

async function seedDatabase(page: Awaited<ReturnType<typeof chromium.launch>>["contexts"][0]["pages"][0]) {
  await page.evaluate(
    ({ accounts, categories, transactions, budgets, currentMonth: month }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open("expenses-app-db");
        req.onsuccess = () => {
          const db = req.result;
          const storeNames = [
            "settings",
            "accounts",
            "categories",
            "transactions",
            "budgets",
          ];
          const tx = db.transaction(storeNames, "readwrite");

          tx.objectStore("settings").put({
            key: "hasCompletedOnboarding",
            value: true,
          });
          tx.objectStore("settings").put({
            key: "mainCurrency",
            value: "USD",
          });
          tx.objectStore("settings").put({
            key: "startupScreen",
            value: "transactions",
          });

          for (const acc of accounts) tx.objectStore("accounts").add(acc);
          for (const cat of categories) tx.objectStore("categories").add(cat);
          for (const txn of transactions)
            tx.objectStore("transactions").add(txn);
          for (const b of budgets) tx.objectStore("budgets").add(b);

          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
    },
    {
      accounts: DEMO_ACCOUNTS,
      categories: DEMO_CATEGORIES,
      transactions: DEMO_TRANSACTIONS,
      budgets: DEMO_BUDGETS,
      currentMonth,
    }
  );
}

async function takeScreenshot(
  page: Awaited<ReturnType<typeof chromium.launch>>["contexts"][0]["pages"][0],
  route: string,
  filename: string
) {
  await page.goto(`${BASE_URL}${route}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  const buffer = await page.screenshot({ fullPage: false });

  await sharp(buffer)
    .resize(TARGET_WIDTH, TARGET_HEIGHT, { fit: "cover", position: "top" })
    .png({ compressionLevel: 8 })
    .toFile(path.join(OUTPUT_DIR, filename));

  console.log(`  Saved ${filename}`);
}

async function main() {
  console.log("Generating PWA screenshots...");
  console.log(`Output: ${OUTPUT_DIR}`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  await page.goto(BASE_URL);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(800);

  await seedDatabase(page);
  console.log("  Seeded demo data");

  await takeScreenshot(page, "/accounts", "screenshot-accounts.png");
  await takeScreenshot(page, "/transactions", "screenshot-transactions.png");
  await takeScreenshot(page, "/overview", "screenshot-overview.png");

  await browser.close();
  console.log("Done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
