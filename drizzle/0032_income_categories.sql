-- Three built-in income categories for everyone: Dividends, Gifts received, and Repaid by others (a system category, never renamed).
INSERT OR IGNORE INTO `categories` (`id`, `user_id`, `name`, `kind`, `is_system`, `is_essential`, `created_at`)
SELECT lower(hex(randomblob(13))), u.`id`, c.`name`, 'income', c.`is_system`, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `users` u
CROSS JOIN (
  SELECT 'Dividends' AS `name`, 0 AS `is_system`
  UNION ALL SELECT 'Gifts received', 0
  UNION ALL SELECT 'Repaid by others', 1
) c;
