# Step 12.2: Local Authentication & Multi-Tenancy Testing Runbook

This guide describes how to run and test authentication, sessions, and business isolation locally using Wrangler and browser or curl.

---

## 1. Prerequisites & Starting the Local Environment

Ensure all dependencies are installed and migrations are applied:

```bash
# 1. Apply local database migrations
npm run db:migrate:local

# 2. Check migration status
npm run db:status:local
```

In terminal 1, start the local Cloudflare Worker backend:
```bash
npm run dev:worker
```
The Worker listens at `http://localhost:8787`.

In terminal 2, start the Vite frontend development server:
```bash
npm run dev
```
The frontend listens at `http://localhost:5173`.

---

## 2. API Testing via cURL / HTTP Requests

### 2.1 Step 1: Bootstrap the Initial Owner & Store
Run this once to initialize the store:

```bash
curl -X POST http://localhost:8787/api/v1/auth/bootstrap \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "owner@northstarmarket.pk",
    "password": "Password123#",
    "name": "Tariq Mehmood",
    "businessName": "Northstar Market",
    "currency": "PKR",
    "branchName": "Main Flagship"
  }'
```

**Expected Response (201 Created):**
- Returns `{ success: true, data: { user: ..., business: ..., branch: ... } }`.
- Generates cookie file `cookies.txt` containing `__session`.

### 2.2 Step 2: Verify Protected Profile Endpoint
Using the session cookie saved in `cookies.txt`:

```bash
curl -X GET http://localhost:8787/api/v1/auth/me \
  -b cookies.txt
```

**Expected Response (200 OK):**
- Returns the authenticated user's profile and active business/branch context.

### 2.3 Step 3: Sign In with Credentials
To log in again or test credential authentication:

```bash
curl -X POST http://localhost:8787/api/v1/auth/sign-in \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "owner@northstarmarket.pk",
    "password": "Password123#"
  }'
```

### 2.4 Step 4: Verify Multi-Tenant Business & Branch Endpoints
List accessible businesses:
```bash
curl -X GET http://localhost:8787/api/v1/businesses \
  -b cookies.txt
```

List accessible branches under the active business:
```bash
curl -X GET http://localhost:8787/api/v1/branches \
  -b cookies.txt
```

### 2.5 Step 5: Test Cross-Tenant Rejection
Attempting to pass a non-existent or foreign business ID:
```bash
curl -X GET http://localhost:8787/api/v1/branches \
  -b cookies.txt \
  -H "X-Business-Id: foreign-biz-uuid"
```

**Expected Response (403 Forbidden):**
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Access to specified business is denied."
  }
}
```

### 2.6 Step 6: Sign Out
```bash
curl -X POST http://localhost:8787/api/v1/auth/sign-out \
  -b cookies.txt \
  -c cookies.txt
```

Calling `GET /api/v1/auth/me` afterwards will return `401 AUTHENTICATION_REQUIRED`.

---

## 3. Frontend End-to-End Testing Flow

1. Open `http://localhost:5173` in your browser.
2. If unauthenticated, `ProtectedRoute` automatically redirects you to `http://localhost:5173/login`.
3. In the login form, enter:
   - Email: `owner@northstarmarket.pk`
   - Password: `Password123#`
4. Click **Sign in**.
5. Upon successful authentication, you are redirected to `/dashboard`.
6. Notice the top header displays the user's name, initials (`TM`), and role (`OWNER`).
7. Click the user avatar in the header and click **Sign out**.
8. The session is revoked on the backend, the cookie cleared, and you are redirected back to `/login`.

---

## 4. Automated Regression Tests

Run the full automated test suite anytime:

```bash
npm run test
```

Expected result: **11 test files passing, 111 tests passing**.

