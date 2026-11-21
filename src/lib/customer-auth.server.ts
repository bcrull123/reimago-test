/**
 * FUTURE — customer accounts (NOT built yet; nothing imports this file).
 *
 * Bob, round 12: "We need a secret admin login. We will have a regular login for customers once they sign up."
 * The two logins must never mix:
 *
 *   ADMIN (built, round 12)                         CUSTOMER (this stub)
 *   --------------------------------------------   ----------------------------------------------
 *   module   src/lib/admin-auth.server.ts           src/lib/customer-auth.server.ts (+ the Better Auth stack in src/lib/auth/*)
 *   where    the secret path in env ADMIN_PATH      public /login, /signup, /account
 *   cookie   rmg_admin  (Path=/<ADMIN_PATH>)         rmg_customer (Path=/)
 *   secret   ADMIN_SESSION_SECRET / ADMIN_PASSWORD   its own CUSTOMER_SESSION_SECRET (or Better Auth's own secret)
 *   users    one shared password (ADMIN_PASSWORD)    one account per customer (email + password / link), stored in the database
 *
 * Rules for whoever builds it: a customer session must never be accepted by an admin route and vice versa
 * (different cookie name, different secret, different payload `k` = "customer"); /login and /account may be linked
 * from the site, the admin path never is; a customer lead can be linked to an account by email later.
 */
export const CUSTOMER_COOKIE = "rmg_customer";
export const CUSTOMER_LOGIN_PATH = "/login";
export const CUSTOMER_ACCOUNT_PATH = "/account";
