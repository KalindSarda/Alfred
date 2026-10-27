/**
 * Prints the SQL that creates the single initial user, their settings and the default categories.
 * There is no public signup, so this is the only way an account comes to exist.
 *
 *   node scripts/bootstrap-user.ts you@example.com > bootstrap.sql
 *   npx wrangler d1 execute finance-tracker --local  --file bootstrap.sql
 *   npx wrangler d1 execute finance-tracker --remote --file bootstrap.sql
 *
 * Safe to run twice: every statement is INSERT OR IGNORE keyed on the email.
 */
import {
  CASHBACK_CATEGORY,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
} from "../src/db/defaultCategories.ts";
import { newId } from "../src/utils/id.ts";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email) || email.length > 254) {
  console.error("Usage: node scripts/bootstrap-user.ts <email>");
  process.exit(1);
}

const now = new Date().toISOString();
const lines: string[] = [
  `INSERT OR IGNORE INTO users (id, email, created_at) VALUES ('${newId()}', '${email}', '${now}');`,
  `INSERT OR IGNORE INTO app_settings (user_id) SELECT id FROM users WHERE email = '${email}';`,
];

const addCategory = (name: string, kind: "expense" | "income", isSystem: boolean) => {
  const escaped = name.replace(/'/g, "''");
  lines.push(
    `INSERT OR IGNORE INTO categories (id, user_id, name, kind, is_system, created_at) ` +
      `SELECT '${newId()}', id, '${escaped}', '${kind}', ${isSystem ? 1 : 0}, '${now}' FROM users WHERE email = '${email}';`,
  );
};

for (const name of DEFAULT_EXPENSE_CATEGORIES) addCategory(name, "expense", false);
for (const name of DEFAULT_INCOME_CATEGORIES) addCategory(name, "income", name === CASHBACK_CATEGORY);

console.log(lines.join("\n"));
